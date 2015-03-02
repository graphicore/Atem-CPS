define([
    'metapolator/errors'
  , './_Node'
  , './GenericCPSNode'
  , './SimpleSelector'
], function(
    errors
  , Parent
  , GenericCPSNode
  , SimpleSelector
) {
    "use strict";

    var CPSError = errors.CPS;

    /**
     * A CompoundSelector is a chain of one or more `SimpleSelector`s
     *
     * a compound selector is invalid if
     *      - it has more than one of universal or type selector
     *      - a universal or type selector occurs at a later than
     *        the first position
     *      - if it is empty
     *
     * simple selectors:
     *          universal, type, id, class, id, pseudo-class pseudo-element
     */
    function CompoundSelector(selectors, source, lineNo) {
        Parent.call(this, source, lineNo);
        this._specificity = undefined;

        if(selectors.length === 0)
            throw new CPSError('CompoundSelector has no SimpleSelector items');

        this._value = selectors.slice();
        if(!(this._value[0].type in {'universal': null, 'type': null})) {
            this._value.unshift(new SimpleSelector('universal', '*',
                                            undefined, source, lineNo));
            this._value[0].___implicit = true;
        }

        var i,l
          , selector
          , invalid = false
          , message
          ;
        for(i=0,l=this._value.length;i<l;i++) {
            selector = this._value[i];
            if(selector.invalid) {
                invalid = true;
                message = 'Invalid selector: ' + selector;
                break;
            }
            if(i !== 0
                    && selector.type in {'universal': null, 'type': null}) {
                invalid = true;
                message = ['Type Selector and Universal selector'
                                , 'can only be the first in a CompoundSelector'
                                , 'but found "'+ selector +'" at position:'
                                , (i+1)].join(' ');
                break;
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
                // a element type name or *
                value: this._value[0].name
              , enumerable: true
            }
        });
        this._normalizedValue = undefined;
        this._normalizedName = undefined;
        this.compiled = false;
        this.matches = matchesPlaceholder;
    }

    function matchesPlaceholder(element, selectorEngine) {
        /*jshint validthis: true */
        if(selectorEngine) {
            this.compile(selectorEngine);
            return this.matches(element);
        }
        throw new CPSError('Not yet compiled, use the `compile` method '
                        + 'or supply an instance of SelectorEngine to '
                        + 'this method as a second argument');
    }

    var _p = CompoundSelector.prototype = Object.create(Parent.prototype);
    _p.constructor = CompoundSelector;

    _p.toString = function() {
        // don't serialize the first item if it's marked as implicit
        return (this._value[0] && this._value[0].___implicit
                    ? this._value.slice(1)
                    : this._value
            ).join('');
    };

    _p.compile = function(selectorEngine) {
        this.matches = selectorEngine.compileCompoundSelector(this);
        this.compiled = true;
    };

    Object.defineProperty(_p, 'value', {
        get: function() {
            // if _value is truthy return a copy of the _value array
            // if value is falsy, return its falsy value (probably undefiend)
            return this._value && this._value.slice();}
    });

    /**
     *  sort by type, then by name if type equals.
     */
    function normalize(a, b) {
        var order = {'type':0, 'universal':0, 'id':1, 'pseudo-class':2, 'class':3}
          , val = order[b.type] - order[a.type]
          ;
        return val || (a.name < b.name) ? -1 : (a.name > b.name ? 1 : 0);
    }

    Object.defineProperty(_p, 'normalizedValue', {
        get: function() {
            if(!this._normalizedValue)
                this._normalizedValue = this.value.sort(normalize);
            return this._normalizedValue.slice();
        }
    });
    Object.defineProperty(_p, 'normalizedName', {
        get: function() {
            return this._normalizedName || (this._normalizedName = this.normalizedValue.join(''));
        }
    });

    Object.defineProperty(_p, 'specificity', {
        get: function() {
            var a, b, c, i=0, specificity;
            a = b = c = 0;
            for(;i<this._value.length;i++) {
                specificity = this._value[i].specificity;
                a += specificity[0];
                b += specificity[1];
                c += specificity[2];
            }
            return [a, b, c];
        }
    });

    return CompoundSelector;
});
