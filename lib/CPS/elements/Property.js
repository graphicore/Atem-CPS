define([
    './_Node'
], function(
    Parent
) {
    "use strict";
    /**
     * A Property: name and value
     *
     * This is essentially immutable, to change it replace it with a new
     * Property via its parent (PropertyDict).
     */
    function Property(propertyName, propertyValue, source, lineNo) {
        Parent.call(this, source, lineNo);
        this._value = propertyValue;

        Object.defineProperties(this, {
            'name': {
                value: propertyName.name
              , enumerable: true
            }
          , 'value': {
                value: propertyValue
              , enumerable: true
            }
          , 'invalid': {
                value: propertyValue.invalid
              , enumerable: true
          }
        });

        // Use this for cases where the Property should be identified
        // this represents the value of this property, don't use it
        // for representation. Note: toString is similar, but used
        // for serialization, not for comparison. The implementation of
        // this could change to be just a checksum.
        // Probably only "immutable" cps-nodes will have a `hash` property.
        // In turn only mutable cps-nodes will have a nodeID.
        Object.defineProperty(this, 'hash', {
            value: [this.name, ': ', this._value].join('')
          , enumerable: true
        });
    }
    var _p = Property.prototype = Object.create(Parent.prototype);
    _p.constructor = Property;

    _p.toString = function() {
        return [this.name, ': ', this._value,';'].join('');
    };

    Object.defineProperty(_p, 'message', {
        get: function(){ return this._value.message; }
    });

    return Property;
});
