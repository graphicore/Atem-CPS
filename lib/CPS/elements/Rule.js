define([
    'Atem-CPS/errors'
  , './_Node'
], function(
    errors
  , Parent
) {
    "use strict";

    var ValueError = errors.Value;

    /**
     * The container for selectors and properties.
     */
    function Rule(selectorList, propertyDict, source, lineNo) {
        Parent.call(this, source, lineNo);
        this._selectorList = selectorList;
        Object.defineProperty(this, 'properties', {
            value: propertyDict
          , enumerable: true
        });

        // a receiver of this event is called as
        // handler(subscriberData, 'update', 'update')
        // 1st arg is subscription defined
        // 2nd arg === this channelKey
        // 3rd arg === eventData, injected by the original this.properties event channelKey
        this.properties.on('update', [this, '_trigger'], 'update');
    }

    var _p = Rule.prototype = Object.create(Parent.prototype);
    _p.constructor = Rule;

    _p.toString = function() {
        return [this._selectorList, ' ', this.properties].join('');
    };

    Object.defineProperty(_p, 'invalid', {
        get: function(){
            return this._selectorList.invalid;
        }
    });

    /**
     * If no namespaces are provided, the result of this method equals
     * this._selectorList.
     */
    _p.getSelectorList = function(namespaces) {
        var selectorList = this._selectorList
          , i, l
          ;
        // Multiply the selectorList on the left by each namespace in turn
        if (namespaces !== undefined) {
            for(i=0, l=namespaces.length;i<l;i++)
                if(namespaces[i] !== null)
                    selectorList = namespaces[i].multiply(selectorList);
        }
        return selectorList;
    };

    _p.setSelectorList = function(selectorList) {
        if(selectorList.invalid)
            throw new ValueError('Trying to set an invalid selectorList: ' + selectorList);
        this._selectorList = selectorList;
        this._trigger(['selector-change', 'update']);
    };

    return Rule;
});
