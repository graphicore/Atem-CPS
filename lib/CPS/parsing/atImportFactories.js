define([
    'Atem-CPS/errors'
  , './curry'
  , './propertyFactories'
  , 'Atem-CPS/CPS/elements/AtImportCollection'
  , 'Atem-CPS/CPS/elements/AtRuleName'
  , 'Atem-CPS/CPS/elements/GenericCPSNode'
], function (
    errors
  , curry
  , propertyFactories
  , AtImportCollection
  , AtRuleName
  , GenericCPSNode
) {
    "use strict";
    var CPSError = errors.CPS
      , genericNameFactory = propertyFactories.genericNameFactory
      ;

    /**
     * override constructors for the purpose of @import.
     * This means for all children of @import we can define other rules.
     * If we don't do so, the regular rules apply. JavaScript Prototype
     * Inheritance.
     *
     * like a module pattern, to not pollute the namespace with
     * temporary variables
     */
    var atImportFactories = Object.create(propertyFactories.factories)
      , atImportParsingSwitch
      ;
    (function(factories) {
            var k;
            for(k in factories) atImportFactories[k] = factories[k];
    })({
        /**
         * Find the name of the resource to load and return a PropertyCollection
         */
        'atrules': function(node, source, ruleController) {
            /*jshint sub:true*/
            var args, resource, atImportCollection;
            // filter all whitespace
            args = node.children.slice(1).filter(function(child) {
                if(child.instance instanceof GenericCPSNode && child.instance.type === 's')
                    return false;
                return true;
            });

            // accept only one argument which must be a string
            if(args.length !== 1
                || !(args[0].instance instanceof GenericCPSNode
                                    && args[0].instance.type === 'string'))
                return this['__GenericAST__'](node, source);
            resource = args[0].data.slice(1,-1);

            atImportCollection = new AtImportCollection(ruleController, source, node.lineNo);
            atImportCollection.setResource(false, resource);
            // TODO: we can set up the parser easier for asynchronisity,
            // since the AtImportCollection now handles receiving the
            // property collection from ruleController. we could just
            // register the promise somewhere central that central place
            // would wait for all registered promises to "end (successful
            // or not, we must handle then)
            // Useful is the atImportCollection only when
            // !atImportCollection.invalid otherwise it can't be queried
            // for contents
            return atImportCollection;

        }
      , 'atkeyword': curry(genericNameFactory, AtRuleName)
    });

    function test_switchToAtImport(data) {
        return (data[0] === 'atrules'
              && data[1] && data[1][0] === 'atkeyword'
              && data[1][1] && data[1][1][0] === 'ident'
              && data[1][1][1] === 'import'
        );
    }

    atImportParsingSwitch = [test_switchToAtImport, atImportFactories];

    return {
        factories: atImportFactories
      , atImportParsingSwitch: atImportParsingSwitch
    };
});
