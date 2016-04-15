define([
    'Atem-CPS/errors'
  , './_Node'
], function(
    errors
  , Parent
) {
    "use strict";

    /**
     * This may become an interface for enhancement via plugins.
     *
     * simple selectors:
     *          universal, type, id, class, id, pseudo-class pseudo-element
     */
    function SimpleSelector(type, name, value, source, lineNo) {
        Parent.call(this, source, lineNo);
        this._specificity = null;
        var invalid = false, message;

        // remove escaping
        if(name && name.indexOf('\\') !== -1)
            name = name.replace('\\', '');

        if(!(type in this._supportedTypes)) {
            invalid = true;
            message = 'Type of SimpleSelector is unsupported:' + type;
        }
        else if(name === undefined) {
            invalid = true;
            message = 'Name of SimpleSelector is unkown!';
        }
        else if(type === 'pseudo-class' && name === 'i') {
            if(value === undefined || value !== value || typeof value !== 'number') {
                invalid = true;
                message = 'No valid value for pseudoclass "i": ('
                                            + typeof value +') '  + value;
            }
        }
        Object.defineProperties(this, {
            'selects': {
                value: !invalid
              , enumerable: true
            }
          , 'invalid': {
                value: invalid
              , enumerable: true
            }
          , 'message': {
                value: message
              , enumerable: true
            }
          , 'type': {
                value: type
              , enumerable: true
            }
          , 'name': {
                value: name
              , enumerable: true
            }
          , 'value': {
                value: value
              , enumerable: true
            }
        });
    }

    var _p = SimpleSelector.prototype = Object.create(Parent.prototype);
    _p.constructor = SimpleSelector;

    _p.toString = function(unescaped) {
        // FIXME: Add back escaping, where needed.
        // maybe we need a flag to switch that on and off
        // the rule below is not enough
        // also, when building selectors from element properties,
        // well need a escpape method.
        var name = unescaped ? this.name : this.name.replace(':', '\\:');
        switch(this.type) {
            case 'universal':
            case 'type':
                return name;
            case 'class':
                return '.' + name;
            case 'id':
                return '#' + name;
            case 'pseudo-element':
                return '::' + name;
            case 'pseudo-class':
                return ':'  + name
                            + (this.value !== undefined
                                    ? '('+this.value+')'
                                    : '');
        }
    };

    _p._supportedTypes = {
        'universal': null
      , 'type': null
      , 'class': null
      , 'id': null
      , 'pseudo-class': null
      , 'pseudo-element': null
    };
    Object.defineProperty(_p, 'specificity', {
        get: function() {
            var s = this._specificity;
            if(!s) {
                var a, b, c;
                a = b = c = 0;
                switch(this.type) {
                    case 'id':
                        a = 1;
                        break;
                    case 'class':
                    case 'attribute': // unsupported at the moment
                    case 'pseudo-class':
                        b = 1;
                        break;
                    case 'type':
                    case 'pseudo-element':
                        c = 1;
                        break;
                }
                this._specificity = s = [a, b, c];
            }
            return s;
        }
    });

    return SimpleSelector;
});
