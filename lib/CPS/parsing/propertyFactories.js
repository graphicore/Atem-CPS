define([
    'Atem-CPS/errors'
  , './curry'
  , './selectorFactories'
  , 'Atem-CPS/CPS/elements/PropertyCollection'
  , 'Atem-CPS/CPS/elements/PropertyDict'
  , 'Atem-CPS/CPS/elements/Property'
  , 'Atem-CPS/CPS/elements/PropertyName'
  , 'Atem-CPS/CPS/elements/PropertyValue'
  , 'Atem-CPS/CPS/elements/AtRuleName'
  , 'Atem-CPS/CPS/elements/AtNamespaceCollection'
  , 'Atem-CPS/CPS/elements/SelectorList'
  , 'gonzales/gonzales'
  , './parseSelectorList'
], function (
    errors
  , curry
  , selectorFactories
  , PropertyCollection
  , PropertyDict
  , Property
  , PropertyName
  , PropertyValue
  , AtRuleName
  , AtNamespaceCollection
  , SelectorList
  , gonzales
  , parseSelectorList
) {
    "use strict";
    /*jshint sub:true*/
    var CPSError = errors.CPS;

    /**
     * Constructors OR factory functions
     * this can be both because JavaScript allows to call a factory function
     * using the new operator like in `new myfactory()`. The factory must
     * return a new object in this case.
     *
     * all constructors take the following arguments: (node, source)
     * @node: object as created by parserEngine._makeNode and augmented by
     * parserEngine
     * @source: instance of parsing/Source
     *
     * We'll use mostly factories, because the "node" we use as argument
     * is not exactly a nice interface. However, it's called _nodeConstructors
     * because that implies that these functions are being called using
     * the `new` keyword.
     *
     * see: https://github.com/css/gonzales/blob/master/doc/AST.CSSP.en.md
     */

    function genericNameFactory (Constructor, node, source) {
        var comments = node.children
                .filter(function(item) {
                    return (item.type === 'comment');
                }).
                map(function(item){
                    return item.instance;
                }
            )
          , name
          ;

        if(node.children[0].type !== '__GenericAST__'
                && node.children[0].instance.type !== 'ident')
            throw new CPSError(['The first child of "'+node.type+'" is '
                , 'expected to be an __GenericAST__ of type "ident", '
                , 'but got "', node.children[0].type, '" '
                , 'type: "', (node.children[0].instance
                        ? node.children[0].instance.type
                        : '<no instance>'), '" '
                ,'in a '+node.type+' from: ', source, 'line: '
                , node.lineNo
                ,'.'].join(''), (new Error()).stack);
        name = node.children[0].data;
        return new Constructor(name, comments ,source, node.lineNo);
    }

    // inherit from selectorFactories
    var propertyFactories = Object.create(selectorFactories);

    (function(factories){
        var k;
        for(k in factories) propertyFactories[k] = factories[k];
    })({
        /**
         * block:
         *
         * A list of
         * "declaration"
         * "decldelim" (semicolon)
         * "s" (whitespace)
         * and "comment".
         *
         * IMPORTANT: "filter" can occur, which is a like "declaration"
         * but has a special name. This was a rather random pick, I suppose.
         * We can use "filter" AS "declaration", if we need it, OR just let
         * it be a __GenericAST__. Filter has, instead of a "value" a "filterv"
         * This is a bugging inconsequence in gonzales. But we can shield
         * it from higher levels.
         *
         * We rename "declaration" as "Property"
         *
         * We throw away "decldelim" and "s", we keep "declaration",
         * "comment" and __GenericAST__ (which will be produced by from
         * unkown "declaration"s/properties)
         *
         * From the docs: Part of the style in the braces.
         */
        'block': function(node, source) {
            var i=0
              , items = []
              , whitelist = {
                    'comment': null,
                    'declaration': null
                }
              , astBlacklist = {
                    'decldelim': null,
                    's': null
                }
              , children = ('children' in node)
                            ? node.children
                            : []
              , instance
              ;
            for(;i<children.length; i++)
                if(children[i].type in whitelist
                        || (children[i].type === '__GenericAST__'
                            && !(children[i].instance.type in astBlacklist)
                        )
                ) {
                    instance = children[i].instance;
                    items.push(instance);
                    if(instance.invalid) {
                        console.info('FIXME: Get a logger object here, to enable cleaner messaging of this:')
                        console.warn(['adding invalid'
                          , instance.constructor.name + ':'
                          , '"' + instance + '"'
                          , instance.message
                          , instance.source
                          , instance.lineNo].join(' ')
                        );
                    }
                }
            return new PropertyDict(items, source, node.lineNo);
        }

        /**
         * declaration // Property:
         *
         * Key value pair of "property" and "value"
         * We rename "declaration" to "Property" and "property" to "PropertyName"
         *
         * We convert unkown "declaration"s into __GenericAST__
         * objects. But for performance reasons, this decision is made in
         * _makeNode.
         */
      , 'declaration': function (node, source, ruleController) {
            var name, value;

            if(node.children[0].type !== 'property')
                throw new CPSError('The first child of "declaration" is '
                + 'expected to be a "property", but got "' + node.children[0].type +'" '
                +'" in a declaration from: ' + source + 'line: '
                + node.lineNo
                +'.', (new Error()).stack);

            if(node.children[1].type !== 'value')
                throw new CPSError('The second child of "declaration" is '
                + 'expected to be a "value", but got "' + node.children[1].type +'" '
                +'" in a declaration from: ' + source + 'line: '
                + node.lineNo
                +'.', (new Error()).stack);

            name = node.children[0].instance;
            value = node.children[1].instance;
            // selectorListFromString uses the parser but doesn't need
            // initialized properties
            if(ruleController)
                ruleController.initializePropertyValue(name.name, value);
            return new Property(name, value, source, node.lineNo);
        }
        /**
         * property // PropertyName
         *
         * The name of a property.
         *
         * It has as first child an ident, which value is the actual name:
         *          ["ident", "margin"]
         * But it also can have subsequent "s" (whitespace) and "comment"
         * nodes:
         */
         // any{ background-color /*property comment*/: #fff;\n\ }
        /**
         * yields in:
         * ['property',
         *    ['ident', 'background-color'],
         *    ['s', ' '],
         *    ['comment', 'property comment']
         * ]
         *
         * The whitespace is going to be removed.
         *
         * I would try to keep the comments here, however, this is a low
         * priority, because comments are not often used at this position.
         *
         * When printing, all comments go between the name and the colon.
         */
      , 'property': curry(genericNameFactory, PropertyName)
        /**
         * value:
         *
         * The value of a property.
         *
         * It's a list of a lot of different nodes. Besides all things
         * meaningful for the value, Comments can go in here, too.
         * I propose to keep the comments, but print them at the beginning
         * of the value, followed by the value itself. Because we won't be
         * able to restore the correct place in most cases anyways.
         */
      , 'value': function(node, source) {
            var comments = []
              , value = []
              , i,l
              , children = ('children' in node)
                                ? node.children
                                : []
              ;
            for(i=0,l=children.length;i<l;i++)
                children[i] = children[i].instance;
            return new PropertyValue(children.join('') ,source, node.lineNo);
        }
      // tinker on @namespace
      , 'atruler': function(node, source) {
            var name
              , collection
              , selectorList
              , i=0
              ;
            for(;i<node.children.length; i++)
                if(name && collection && selectorList)
                    break;
                else if(!collection
                        && node.children[i].instance instanceof AtNamespaceCollection)
                    collection = node.children[i].instance;
                else if(!name && node.children[i].instance instanceof AtRuleName)
                    name = node.children[i].instance;
                else if(!selectorList && node.children[i].instance instanceof SelectorList)
                    selectorList = node.children[i].instance;
            if ( !name
                    // we only know @namespace here!
                    || name.name !== 'namespace'
                    || !collection)
                return this['__GenericAST__'](node, source);
            // may be undefined
            // if it is, we couldn't parse it
            // an example would be: @namespace("point){}
            // note the " doesn't close
            // TODO: it would be nice to preserve the broken information.
            // so that the AtNamespaceCollection can be repaired better
            // in the ui
            if(selectorList !== undefined)
                collection.selectorList = selectorList;
            collection.name = name.name;
            return collection;
        }
      , 'atkeyword': curry(genericNameFactory, AtRuleName)
      , 'atrulerq': function(node, source, ruleController) {
            var i
              , braces
              , selectorString
              , selectorList
              ;

            // find 'braces'
            for(i=1;i<node.rawData.length;i++)
                if(node.rawData[i][0] && node.rawData[i][0] === 'braces') {
                    braces = node.rawData[i];
                    break;
                }
            if(!braces)
                return this['__GenericAST__'](node, source);

            // we need the quotes only to not break the gonzales parsing
            // in selectorsString, no qotes are necessary. So we simply
            // throw them away at this point, without checking semantics
            // gonzales will fail with non matching quotes anyways
            selectorString = gonzales.csspToSrc(braces)
                // remove the braces
                .slice(1,-1)
                // remove quotes
                .replace(/(\'|\")/gm, '')
                .split(',')
                // remove surrounding whitespace
                .map(function(item){return item.trim();})
                // remove empty entries
                .filter(function(item){return !!item.length;})
                // create a 'normalized' selectorString
                .join(', ');

            try {
                return parseSelectorList.fromString(selectorString, undefined
                        , ruleController && ruleController.selectorEngine);
            }
            catch(error) {
                if(!(error instanceof CPSError))
                    throw error;
            }

            // don't return anything particular
            return this['__GenericAST__'](node, source);
        }
        /***
         * return an AtNamespaceCollection
         * NOTE: at this moment we don't know whether or not this
         * is the collection of AtNamespace or something made up!
         * the aim is to eventually replace AtNamespaceCollection
         * with an enhanced version of PropertyCollection.
         */
      , 'atrulers': function(node, source) {
            var items = []
              , i=0
              , child
              ;
            if(!node.children)
                return this['__GenericAST__'](node, source);
            for(;i<node.children.length;i++) {
                if(node.children[i].type === '__GenericAST__'
                                && node.children[i].instance.type === 's')
                    continue;
                child = node.children[i].instance
                if(child instanceof PropertyCollection && !child.name)
                    // This is to compensate the PropertyCollection created
                    // by the deperecated @dictionary rule. A PropertyCollection
                    // without a name is a plain PropertyCollection, it
                    // can be flattened into the list of children.
                    // FIXME: remove @dictionary for good and then this code.
                    Array.prototype.push.apply(items, child.items)
                else
                    items.push(child);
            }
            // name, selectorList
            return new AtNamespaceCollection(undefined, undefined, items, source, node.lineNo);
        }
    });

    return {
        factories: propertyFactories
      , genericNameFactory: genericNameFactory
    };
});
