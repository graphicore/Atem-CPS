define([
    'Atem-CPS/errors'
  , './_Node'
], function(
    errors
  , Parent
) {
    "use strict";

    var Deprecatederror = errors.Deprecated;

    /**
     * The value of a Property.
     */
    function PropertyValue(valueString ,source, lineNo) {
        Parent.call(this, source, lineNo);

        Object.defineProperty(this, 'valueString', {
            value: valueString
        });

        this.value = undefined;
        this.invalid = false;
        this.message = undefined;
    }
    var _p = PropertyValue.prototype = Object.create(Parent.prototype);
    _p.constructor = PropertyValue;

    _p._setInvalid = function(message) {
        Object.defineProperty(this, 'invalid', {
            value: true
          , enumerable: true
        });

        Object.defineProperty(this, 'message', {
            value: message
          , enumerable: true
        });
    };

    _p._setValue = function(value) {
        if(value === undefined)
            throw new errors.CPS('value may not be undefined');

        Object.defineProperty(this, 'value', {
            value: value
          , enumerable: true
        });
    };

    _p.initialize = function(name, valueFactory) {
        if(this.value !== undefined)
            throw new errors.CPS('this.value is already set!');
        if(this.invalid)
            throw new errors.CPS('Can\'t set value: value is already '
                    + 'marked as invalid: ' + this._message);

        var result = valueFactory(this.valueString);
        if(result[0]) // invalidMessage
            this._setInvalid(result[0]);
        else
            // result[1] is commonly expected an object with
            // Atem-Property-Language/_Expression API but not enforced yet.
            // This may be an angle for making this more reusable. So we
            // use Ducktyping and just expect the right thing to be in
            // result[1]. But, `undefined` is not allowed, see _setValue.
            this._setValue(result[1]);
    };



    Object.defineProperty(_p, 'astTokens', {
        get: function() {
            throw new Deprecatederror('PropertyValue no longer carries this '
                                    + 'kind of gonzales/CSS AST data.');
        }
    });

    /**
     * TODO: We should be able to get the valueString from the valueFactory
     * (Expression) object. This is kind of nasty, because we don't do this
     * at all yet and we'll have to learn how to serialize all our tokens.
     *
     * In the end, the Expression object can be altered and with it the
     * value of it would change! This needs some caution, because right now
     * this PropertyValue is considered immutable. It would stay so, because
     * it just wraps the Expression object, but there's still caution needed.
     */
    _p.toString = function() {
        return this.valueString;
    };

    return PropertyValue;
});
