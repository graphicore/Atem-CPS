define([
    'Atem-CPS/errors'
  , './_Node'
], function(
    errors
  , Parent
) {
    "use strict";
    /**
     * The value of a Property.
     *
     * TODO: the value needs to be examined, we need a canonical version
     * of it. Otherwise one effect is, that we add too much whitespace
     * when serializing with toString (because we don't remove whitespace
     * when extracting the comments)
     * This will probably happen when we start to really process the values.
     */
    function PropertyValue(valueData, comments ,source, lineNo) {
        Parent.call(this, source, lineNo);

        this._valueData = valueData;
        this._comments = comments;
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
            // _FormulaeValue API but not enforced yet. This may be
            // an angle for making this more reusable. So we use Ducktyping
            // and just expect the right thing to be in result[1]
            // But, undefined is not allowed, see _setValue.
            this._setValue(result[1]);
    };

    // this property ommits the comments on purpose
    Object.defineProperty(_p, 'valueString', {
        get: function(){ return this._valueData.join(''); }
    });

    Object.defineProperty(_p, 'astTokens', {
        get: function() {
            return this._valueData.map(
                                function(item){ return item._ast; });
            }
    });

    /**
     * Prints all comments before the value.
     */
    _p.toString = function() {
        return [this._comments.join('\n'),
                this._comments.length ? ' ': '',
                this.valueString.trim()].join('');
    };

    return PropertyValue;
});
