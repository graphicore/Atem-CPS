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
    function PropertyValue(value ,source, lineNo) {
        Parent.call(this, source, lineNo);

        this.value = undefined;
        this.invalid = false;
        this.message = undefined;
        this._valueStringArgument = undefined;

        if(typeof value === 'string')
            // needs a call to initialize then
            this._valueStringArgument = value;
        else
            this._setValue(value);

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

        // TODO: if we coould check the validity of value itself here,
        // we could do `this._setInvalid(message)` in here.
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

        var result = valueFactory(this._valueStringArgument);
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

    _p.toString = function() {
        return this.value
                ? this.value.toString()
                : ''
                ;
    };

    return PropertyValue;
});
