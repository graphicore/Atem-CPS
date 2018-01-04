define([
    'Atem-CPS/errors'
  , './elements/Property'
  , './elements/PropertyDict'
  , './elements/Rule'
  , './elements/AtImportCollection'
  , './elements/PropertyValue'
  , './parsing/parseSelectorList'
  , './elements/SimpleSelector'
],
function (
    errors
  , Property
  , PropertyDict
  , Rule
  , AtImportCollection
  , PropertyValue
  , parseSelectorList
  , SimpleSelector
) {
    "use strict";

    var NotImplementedError = errors.NotImplemented;

    // this are just shortcuts for propertyDict.splice
    // use makeProperty to create the property argument
    function updateProperty(propertyDict, index, property) {
        propertyDict.splice(index, 1, [property]);
    }

    function appendProperty(propertyDict, property) {
        propertyDict.splice(propertyDict.length, 0, [property]);
    }

    function moveCPSElement(source, sourceIndex, target, targetIndex) {
        var property, items;
        if(source === target) {
            // if source and target are identical we can make
            // one atomic replace of all items, instead of two actions.
            // This is done by resetting all items in a new order.
            // This triggers less events so I guess it is cheaper.
            // I may be wrong! So if you have too much time, please measure ;-)
            items = target.items;
            property = items.splice(sourceIndex, 1)[0];
            items.splice(targetIndex, 0, property);
            // now replace all at once
            target.splice(0, items.length, items);
            return;
        }
        // remove
        property = source.splice(sourceIndex, 1)[3][0];
        // insert
        target.splice(targetIndex, 0, property);
    }

    function isProperty(item) {
        return item instanceof Property;
    }

    function addNewRule(propertyCollection, index, selectorListString) {
        var source = 'generated'
          , selectorList = parseSelectorList.fromString(selectorListString)
          , propertyDict = new PropertyDict([], source, 0)
          , rule = new Rule(selectorList, propertyDict, source, 0)
          ;
        // returns the actual index at which the rule was created
        return propertyCollection.splice(index, 0, rule)[0];
    }

    /**
     * CAUTION: Here an intersting dependency to ruleController emerges.
     * Probably this method should be part of the stateful interface,
     * because this way a ruleController from a different project can
     * be used which is not intended right now and was never tested!
     */
    function addNewAtImport(async, propertyCollection
                                , index, ruleController, resourceName) {
        var collection = new AtImportCollection(ruleController, 'generated')
            // it's only a promise if `async` is true
          , promise = collection.setResource(async, resourceName)
          ;

        function resolve() {
            return propertyCollection.splice(index, 0, collection)[0];
        }

        return async
             ? promise.then(resolve, errors.unhandledPromise)
             : resolve()
             ;
    }

    /**
     * initializePropertyValue is a function with the signature:
     * void 0 initializePropertyValue(name, propertyValueInstance);
     *
     * it calls internally:
     *        propertyValueInstance.initialize(name, Expression.factory);
     *
     * It's purpose is to inject the interpreter of the property values
     * into the CPS PropertyValue node. That way we can use different
     * language for properties, for different applications and for
     * experimentation.
     */
    function init(initializePropertyValue) {
        function makeProperty(name, value) {
            var _value = new PropertyValue(value);
            if(_value.value === undefined)
                // this implies that value was a string or number
                // (soon also: true, false, null)
                // otherwise we assume a capable programmer passed an
                // appropriate value
                initializePropertyValue(name, _value);
            return new Property({name:name}, _value);
        }

        /**
         * Will rewrite the whole propertyDict!
         */
        function setProperties(propertyDict, data) {
            var newProperties
              , name
              ;
            if(!data)
                return;
            newProperties = [];
            for(name in data)
                newProperties.push(makeProperty(name, data[name]));
            propertyDict.splice(0, propertyDict.length, newProperties);
        }

        /**
         * Set `value` to the property `name` of `propertyDict`.
         *
         * Arguments:
         * propertyDict: an instance of PropertyDict as returned
         *                by Rule.properties
         * name: a string with the property name
         * value: a string (of cps-formulae-language¹)
         *
         * return value: nothing.
         * raises: potentially a lot.
         *
         * ¹ Actually this depends on which type is registered for `name`
         *   but at the time of this writing there is only cps-formulae-language.
         *   There are, however, properties that check their return type,
         *   after evaluation of the cps-formulae-language.
         */
        function setProperty(propertyDict, name, value) {
            var property = makeProperty(name, value);
            propertyDict.setProperty(property);
        }

        /**
         * Will rewrite the whole propertyDict!
         */
        function setElementProperties(element, data) {
            setProperties(element.properties, data);
        }

        function escapeSelectorName (name) {
            return SimpleSelector.prototype.escape(name);
        }

        return {
              initializePropertyValue: initializePropertyValue
            , makeProperty: makeProperty
            , appendProperty: appendProperty
            , updateProperty: updateProperty
            , moveCPSElement: moveCPSElement
            , isProperty: isProperty
            , setProperty: setProperty
            , addNewRule: addNewRule
            , addNewAtImport: addNewAtImport
            , setProperties: setProperties
            , setElementProperties: setElementProperties
            , escapeSelectorName: escapeSelectorName
        };
    }

    return init;
});
