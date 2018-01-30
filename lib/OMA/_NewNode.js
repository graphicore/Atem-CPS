define([
    'Atem-CPS/errors'
  , 'Atem-CPS/emitterMixin'
], function(
    errors
  , emitterMixin
) {
    "use strict";
    // jshint esnext:true

    const OMAError = errors.OMA
      , NotImplementedError = errors.NotImplemented
      , assert = errors.assert
      , emitterMixinSetup = {
              stateProperty: '_channel'
            , onAPI: 'on'
            , offAPI: 'off'
            , triggerAPI: '_trigger'
        }
      ;

    const Edge = (function() {
    /**
     * An edge can have many instances.
     */
    function Edge(from, to) {
        this._to = to;
        Object.defineProperties(this, {
            from: {
                value: from
              , enumerable: true
            }
          , instances: {
                value: new Set()
              , enumerable: true
            }
        });
    }
    var _p = Edge.prototype;
    _p.constructor = Edge;

    Object.defineProperty(_p, 'to', {
        set: function(to) {
            // TODO: validate?
            this._to = to;
        }
      , get: function() {
            return this._to;
        }
      , enumerable: true
    });

    Edge.factory = function(from, to) {
        return new Edge(from, to);
    };

    return Edge;
    })();

    function _Node(...injectedChildPatterns) {
        /*jshint validthis:true*/
        if(this.constructor.prototype === _p)
            throw new OMAError('OMA _Node must not be instantiated directly');

        // The children will often be multiple times the same, hence it
        // will be hard to tell which instances belongs to which edge.
        // The reliable way is to communicate with the instances via indexes,
        // because those indexes [must be/will be] kept always in sync.
        this._edges = [];
        this._children = null;
        this._childSubscriptions = new Map();
        this._essence = null;
        this._isDeepFrozen = null;
        emitterMixin.init(this, emitterMixinSetup);

        // must be injected! there's no alternative now!
        // this is to have only one way to create these frozen child nodes
        if(this.constructor.$frozenChildren) {
            this.checkInjectedNodes(injectedChildPatterns);
            this.insertAt(0,  injectedChildPatterns);
            Object.freeze(this._edges);
        }
    }
    var _p = _Node.prototype;
    _p.constructor = _Node;
    // see OMAController._initPattern!
    // if this is an array this node isFrozen
    _Node.$frozenChildren = null;
    emitterMixin(_p, emitterMixinSetup);


    _p.checkInjectedNodes = function(nodes) {
        var i, l, fails
          , expectedTypes = this.constructor.$frozenChildren
          ;
        if(expectedTypes.length !== nodes.length)
            throw new OMAError('$frozenChildren demands '+expectedTypes.length+' '
                    + 'nodes but injected are '+nodes.length+' node(s).');

        fails = [];
        for(i=0,l=expectedTypes.length;i<l;i++) {
            if(expectedTypes[i] !== nodes[i].type)
                fails.push('i: '+ i +' <'+ expectedTypes[i]
                                        +'> !== <'+ nodes[i].type +'>');

        }
        if(fails.length)
            throw new OMAError('$frozenChildren types (left) differ from '
                            + 'injected instance types (right):\n  '
                            + fails.join('\n  '));
        return true;
    };


    /**
     * Implement this like so:
     *
     * ```
     * Object.defineProperty(_p, 'makeProperty', {value: cpsTools.makeProperty });
     * ```
     *
     * NOTE: cpsTools.makeProperty is dependent on the actual setup of
     * your object model. That's why it is not defined in here.
     */

    Object.defineProperty(_p, 'makeProperty', {
        get: function() {
            // this should be implemented by items inheriting from _Node
            throw new NotImplementedError('Implement CPS-Type name!');
        }
    });

    /**
     * Implement a getter for CPS Type in sub classes of _Node, we need
     * it for the cps selector engine and some other things.
     *
     * cpsType should be a simple string, minuses are ok, don't do
     * anything fancy.
     *
     * Don't use already taken names.
     * TODO: come up with some namespace scheme to make this easier.
     */
    Object.defineProperty(_p, 'type', {
        get: function() {
            // this should be implemented by items inheriting from _Node
            throw new NotImplementedError('Implement CPS-Type name!');
        }
    });

    /**
     * A Node of this type must guarantee that all of it's instances/patterns
     * have the same child structure.
     */
    Object.defineProperty(_p, 'isFrozen', {
        get: function() {
            // we can't use this.constructor.$frozenChildren directly
            // because the constructor needs to set the children first,
            // using `insertAt` which itself uses isFrozen.
            // var isFrozen = !!this.constructor.$frozenChildren;
            return  Object.isFrozen(this._edges);
        }
    });

    /**
     * A Node of this type must guarantee that all of it's instances/patterns
     * the same child structure and that the childrens children are deepFrozen
     * as well.
     *
     * Patterns (instances of Nodes), that are deep frozen will be treated as
     * singletons. There's no good reason to have multiple instances of these.
     */
    Object.defineProperty(_p, 'isDeepFrozen', {
        get: function() {
            if(this._isDeepFrozen !== null)
                this._isDeepFrozen = this.isFrozen
                    // and all children are fixed
                    && (this._edges.filter(edge=>!edge.to.isDeepFrozen).length === 0);
            return this._isDeepFrozen;
        }
    });


    _p.toString = function() { return ['<Pattern:', this.type, '>'].join('');};

    _p.isOMANode = function(item) {
        return item instanceof _Node;
    };

    /**
     * Enhance this dict with accepted children type: Constructor pairs
     *
     * TODO: add duck-typing as a strategy, e.g. "has a public draw function"
     */
    _p._acceptedChildren = Object.create(null);

    _p.qualifiesAsChild = function(item) {
        if(!this.isOMANode(item))
            return false;

        if(item.type in this._acceptedChildren
                    && item instanceof this._acceptedChildren[item.type])
            return true;
        return false;
    };

    /* This is very unspecific on purpose, I can think of lots of
     * options to define validators for different purposes.
     * One of the biggest alternatives was to inject them via
     * the CPS-Controller into StyleDict, which would make the
     * validators of an OMA implementation configurable per application.
     * If that kind of freedom is needed (I think this is rather
     * a bad idea), then the object model could add a setValidator
     * method, operated by the CPS-Controller, for example.
     * However, to make an OM behave constantly across applications
     * (I think this is desirable) it is good to attch these
     * validators to the object model.
     */
    _p.getValidator = function(key) {
        //jshint unused:false
        return null;
    };

    Object.defineProperty(_p, 'children', {
        /**
         * returns a copy of this._children so we can't mess around
         * with the list of children via public interfaces.
         */
        get: function() {
            if(this._children === null) {
                this._children = this._edges.map(function(edge){
                    return edge.to;
                });
                Object.freeze(this._children);
            }
            return this._children;
        }
    });

    Object.defineProperty(_p, 'childrenLength', {
        /**
         * FWIW, a bit faster than calling node.children.length
         */
        get: function(){ return this._edges.length; }
    });

    _p.getChild = function(index) {
        assert(!!this._edges[index], 'Edge must exist');
        return this._edges[index].to;
    };

    _p.getEdgeByInstance = function(instance) {
        assert(this._edges[instance.index].instances.has(instance)
                                        , 'Instance must be registered');
        return this._edges[instance.index];
    };

    _p.getEdge = function(index) {
        assert(!!this._edges[index], 'Edge must exist');
        return this._edges[index];
    };

    /**
     * TODO: if this.isDeepFrozen => we can skip getting the essence
     * of the children, because it's fixed.
     */
    _p._getEssenece = function() {
        return [
                   // NOTE: there are no escapes performed here
                   // thus: '[', ']' and ',' must not be type names,
                   // otherwise we can inject wrong essence information.
                   // But, essence is not intended to be parsed (only
                   // compared) the impact of this is probably limited.
                   this.type
                 , '['
                 , this.children.map(c=>c.essence).join(',')
                 , ']'
               ].join('');
    };

    /**
     * Returns a string representing the structure of the node tree.
     */
    Object.defineProperty(_p, 'essence', {
        get: function(){
            if(!this._essence) {
                // Must be invalidated when this.children or the
                // essence of this or any of this.children changes!
                // see: this._essenceChanged()
                this._essence = this._getEssenece();
            }
            return this._essence;
        }
      , enumarable: true
    });

    /**
     * Is used as both: a Handler when a child-essence changed and the
     * trigger when the essence change orignated here.
     */
    _p._essenceChanged = function() {
        this._essence = null;
        this._trigger('essence');
    };

    _p.isEssenceCompatible = function(pattern) {
        return this.essence === pattern.essence;
    };

    /**
     * Set this to true in a subclass if it should manage the ids of
     * it's descendants.
     */
    Object.defineProperty(_p, 'idManager', {
        value: false
    });

    _p.registerEdgeInstance = function(instance) {
        assert(instance.parent.pattern === this
                        , 'Instance must be an edge from this pattern');
        assert(instance.index < this._edges.length
                        , 'Instance.index must be in edges.');
        assert(this._edges[instance.index].to === instance.pattern
                        , 'Instance pattern must match edge pattern.');
        this._edges[instance.index].instances.add(instance);
    };

    // Do we ever need this. Technically, when the edge is gone,
    // the instance is gone, too. So this is probably too much cleaning
    // up!
    // TODO: make sure this is not needed.
    _p.unregisterEdgeInstance = function(instance) {
        assert(instance.index < this._edges.length
                        , 'Instance.index must be in edges.');
        assert(this._edges[instance.index].pattern === instance.pattern
                        , 'Instance pattern must match edge pattern.');
        this._edges[instance.index].instances.delete(instance);
    };

    function _getCanonicalStartIndex(start, length) {
        if(start >= length)
            return length;
        if(start < 0)
            return Math.max(0, length - start);
        return start;
    }

    // this used to have a splice function, but with the new model of patterns
    // and instances this becomes overly complex.
    // instead there will be two methods as a replacemant:
    // `insertAt(startIndex, _insertions)` and removeFrom(startIndex, deleteCount)
    // these two should be able to replace most usages of `node.splice`
    // NOTE: moving is no longer supported via this interface, since
    // the same instance
    // _p.splice = function(startIndex, deleteCount, _insertions /* single item or array of items */)

    // TODO: maybe we rather need a move that can also move between nodes
    // not just within one, *WHILE* also moving the instance data (if possible)
    // though, moving instance data may only be feasible automatically when
    // moving within the same node! In other cases, instance level
    // cut/copy/paste of instance data may be better suited.
    _p.move = function(from, to) {
        // jshint unused:vars
        throw new NotImplementedError('TODO: if a use case comes up.');
    };

    _p.insertAt = function(startIndex,  _insertions /* single item or array of items */) {
        if(this.isFrozen)
            throw new OMAError('Inserting children is not allowed in this element.');
        if(!insertions.length)
            return;
        var insertions = _insertions instanceof Array
                ? _insertions
                : (_insertions === undefined ? [] : [_insertions])
          , canonicalStartIndex = _getCanonicalStartIndex(startIndex, this._edges.length)
          , notAccepted, args
          ;

        notAccepted = insertions.filter(function(item) {
            //jshint validthis: true
            return !this.qualifiesAsChild(item);
        }, this);
        if(notAccepted.length)
            throw new OMAError([this, 'doesn\'t accept', notAccepted.join(', ')
                                        , 'as child type(s).'].join(' '));

        FIXME;// take care of circular references

        insertions = insertions.map(to => Edge.factory(this, to));
        args = [canonicalStartIndex, 0];
        Array.prototype.push.apply(args, insertions);
        Array.prototype.splice.apply(this._edges, args);

        this._children = null;

        // subscribe if not already subscribed:
        insertions.forEach(child=>{
            if(!this._childSubscriptions.has(child)) {
                let off = child.on('essence', [this, '_essenceChanged']);
                this._childSubscriptions.set(child, off);
            }
        });

        // instances must now deal with initializing/reorganizing their children
        this._trigger('inserted', [canonicalStartIndex, insertions.length]);
        this._essenceChanged();// will call this._trigger('essence')
    };

    _p.removeAt = function(startIndex, deleteCount) {
        if(this.isFrozen)
            throw new OMAError('Adding or removing children is not allowed in this element.');
        var canonicalStartIndex = _getCanonicalStartIndex(startIndex, this._edges.length)
          , deleted
          ;

        deleted = this._edges.splice(canonicalStartIndex, deleteCount);
        this._children = null;

        // unsubscribe from fully deleted childen
        let childrenSet = new Set(this.children);
        deleted.map(edge=>edge.to)
               .filter(child=>!childrenSet.has(child))
               .forEach(deleted=>{
                   let off = this._childSubscriptions.get(deleted);
                   off();
                   this._childSubscriptions.delete(deleted);
                });

        if(deleted.length) {
            // instances must now deal with initializing/reorganizing their children
            // Sends also deleted, because we can't observe what has been
            // deleted in this node anymore; the instances can know though
            // because all child instances have a reference to their pattern.
            this._trigger('removed', [canonicalStartIndex, deleted.length, deleted]);
            this._essenceChanged();// will call this._trigger('essence')
        }
    };

    return _Node;
});
