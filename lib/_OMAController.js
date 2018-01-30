define([
    'Atem-CPS/errors'
  , 'Atem-CPS/OMA/_Node'
  , 'Atem-CPS/OMA/Instance'
  , 'Atem-CPS/OMA/InstanceData'
  , 'Atem-CPS/OMA/RootAPI'
], function(
    errors
  , _Node
  , Instance
  , InstanceData
  , RootAPI
) {
    "use strict";
    // jshint esnext:true

    var OMAError = errors.OMA
      , KeyError = errors.Key
      , NotImplementedError = errors.NotImplemented
      , assert = errors.assert
      ;

    /**
     * TODO: consider merging with _Controller.js
     *
     * The OMAController is managing the (Tree)Nodes, TreePatterns and TreeInstances.
     *
     * A (JavaScript) instance of a _Node is a Pattern,
     * The instance tree is build from Patterns. Each Instance is linked
     * to a parent:owns pattern edge.
     *
     * Changes to the intance tree can only be made by changing the underlying
     * patterns.
     */
    function OMAController(TreeNodesTypes, rootTypeName) {
        // the root instance will be a pattern of this node
        this._rootTypeName = rootTypeName;
        TreeNodesTypes.forEach(this.addNodeType, this);
        this._nodeTypes = new Map(); // typeName => NodeTypeConstructor
        this._singletons = new Map(); // typeName => instance
        this._singletonTypes = new Map(); // typeName => boolean

        // instances of NodeTypes are patterns
        // these patterns also have the :owns edges set
        this._patterns = new Map();// TODO: other datastructure... how ever needed
        this._root = null;

        this._controller = null;

        // a root instance is the source of all instances in the instance tree!
        // and as such, this controller is in extension the source of all instances
        // It's important to note that different roots are not connected by any edges
        // right now, I'm only implementing a single root.
        // One CPS controller can only work for instances with the same
    }

    var _p = OMAController.prototype;

    // To implement plugins, it should be possible to use this on runtime
    // i.e. via some NodeType plugin manager.
    _p.addNodeType = function(NodeType) {
        // I'm hoping that we can have a more liberal duck typing kind in
        // the future. Still, inheriting from OMA._Node is the preferred
        // way to go and most probably the best one in almost all cases.
        // And, if we insist on _Node, force the same version (instance!)
        // of the lib also for all plugins and children, which sounds
        // wise for stability but maybe a bit annoying in cases of
        // dependency hell ... (!). This is a decision pro-stability,
        // we'll work on depemndency hell later.
        if(!_Node.prototype.isPrototypeOf(NodeType.prototype))
            throw new OMAError( 'NodeType.prototype must be based on '
                              + 'OMA/_Node.prototype!');
        if(this._nodeTypes.has(NodeType.prototype.type))
            throw new OMAError('A NodeType "' + NodeType.prototype.type
                              + '" is already registered');
        this._nodeTypes.set(NodeType.prototype.type, NodeType);
    };

    _p.removeNodeType = function(type) {
        // jshint unused: vars
        // to remove a type, we must check if it is used anywhere and
        // handle it gracefully when the node is removed, maybe save the
        // data for (maybe) later?.
        // We should maybe also give some options to the user how to handle
        // that, or warn, or deny to remove the type
        throw new NotImplementedError('Not implemented: removeNodeType');
    };

    // are all patterns named patterns?
    // the name is not relevant actually! each tree and sub-tree is a
    // pattern. Naming it could make it more useful though.
    _p.addPattern = function(pattern, indexId/*, name*/) {
        if(!this._nodeTypes.has(pattern.type))
            throw new OMAError('NodeType of pattern "' + pattern.type
                    + ' is not registered. See: addNodeType');
        // TODO: the pattern must be an instance of the registered NodeType

        // no idea how these should be stored, yet...
        this._patterns.set(pattern, indexId);
    };

    _p.addPatterns = function(patterns) {
        var i, l;
        for(i=0,l=patterns.length;i<l;i++)
            this.addPattern(patterns, i);
    };

    _p._getNodeType = function(typeName) {
        var Constructor = this._nodeTypes.get(typeName);
        if(!Constructor)
            throw new KeyError('A NodeType is missing "' + typeName + '"');
        return Constructor;
    };

    // FIXME: it would be awesome if we could control singletons via this
    // e.g. a MOM penstroke <center> where isDeepFrozen === true
    // only *AFTER* _initPattern should only have one instance ever!
    _p._makePattern = function(typeName) {
        var Constructor, pattern;
        if(this._singletons.has(typeName))
            return this._singletons.get(typeName);
        Constructor = this._getNodeType(typeName);
        pattern = Object.create(Constructor.prototype);
        if(this.typeIsSingleton(typeName))
            this._singletons.set(typeName, pattern);
        return pattern;
    };

    /**
     * This is *very* similar to pattern.isDeepFrozen but it works
     * on without initialized types and it predicts/expects behavior
     * rather than reporting the actual facts. Nevertheless, this and
     * pattern.isDeepFrozen should not contradict, once the pattern is
     * fully initialized!
     */
    _p.typeIsSingleton = function(typeName) {
        var Constructor, childTypeName
          , isSingleton = this._singletonTypes.get(typeName)
          ;
        if(typeof isSingleton !== 'boolean') {
            Constructor = this._getNodeType(typeName);
            if(!Constructor.$frozenChildren)
                isSingleton = false;
            else {
                isSingleton = true;
                checkChildren:
                for(childTypeName of Constructor.$frozenChildren) {
                    if(!this.typeIsSingleton(childTypeName)) {
                        isSingleton = false;
                        break checkChildren;
                    }
                }
            }
            this._singletonTypes.set(typeName, isSingleton);
        }
        return isSingleton;
    };

    _p._initPattern = function(pattern, nodes) {
        var Constructor = pattern.constructor
          , inject
          ;

        // TODO: this._initiated = new WeakSet();
        // don't init the same pattern twice
        if(this._initiated.has(pattern))
            throw new OMAError('The pattern ' + pattern + ' is already initiated');
        this._initiated.add(pattern);

        if(Constructor.$frozenChildren) { // <= good /start/ indicator for singletons?
            // make sure the types are OK

            FIXME;// hmm, for deserialization, nodes would always be an array
            // but for a regular initialisation it is rather
            // the normal case that we don't have the children already.
            // AND this._makePattern allone wouldn't do the trick!
            inject = nodes
                ? nodes
                : Constructor.$frozenChildren
                             .map(typeName=>this._makePattern(typeName))
                ;

            FIXME; // => make initialization in topological order!
            // At this point all inject-patterns must already be
            // initialized!!! This is because we need the `on` subscription
            // to be initialzed now!
            // A topological ordering however *needs* an acyclic graph!
            // Thus, we either disallow cyclic graphs forever (the to go
            // solution to this would only simulate them anyways!). OR
            // we can savely say, that for `frozen` patterns cyclic
            // references are forbidden.
            // *AT* the moment, cyclic refs are forbidden anyways, thus
            // it's probably best to proceed for now!
            Constructor.apply(pattern, inject);
            assert(pattern.isFrozen, 'Constructors that define $frozenChildren '
                                        + 'must freeze their `_edges` array');
        }
        else {
            Constructor.call(pattern);
            // assert pattern.childrenLength === 0
            pattern.splice(0, pattern.childrenLength, nodes);
        }
    };

    /**
     * This is used to normalize loops. Hence, each weight returned
     * must be unique for each pattern (we may rather call it id thus)
     *
     */
    _p._getPatternIndexId = function(pattern) {
        return this._patterns.get(pattern);
    };

    /**
     * This normalization ensures that all unique loops appear the same
     * but it has no further semantic meaning.
     * So, using it to break a loop is not yielding in the best possible
     * result, the break is just somewhere.
     */
    _p._normalizeLoop = function(loop) {
        var weights = loop.map(this._getPatternIndexId, this)
          , min = Math.min.apply(null, weights)
          , index = weights.indexOf(min)
          ;
        // rotate, so that loop starts with index
        Array.prototype.unshift.apply(loop, loop.splice(index, loop.length));
        return loop;
    };

    /**
     * Returns paths of all loops/cycles within toPatterns.
     * Ideally no loop is reported double, all loops are unique, but that was not tested ;-)
     * A loop-path starts with the element that is connected to the last
     * element of the loop-path, i.e. there are no double entires in a loop
     * path.
     * A loop is unique when all patterns appear in the same order
     * regardless of the start-element. This means a loop can start with
     * any element within the loop-path and is still considered unique,
     * no matter how it's been rotated. (we need a way to weight/sort
     * patterns uniquely, to enable normalization of loops).
     */
    _p._findLoops = function(state, patterns) {
        // depth-first-traversal
        var state_ = state ? state : {
                path: []
              , seen: new Set()
              , inPath: new Map()
            }
          , loops = []
          , i, l, pattern, index, loop
          ;

        for(i=0,l=patterns.length;i<l;i++) {
            pattern = patterns[i];
            if(state_.seen.has(pattern))
                continue;

            if(state_.inPath.has(pattern)) {
                // found a loop
                index = state_.inPath.get(pattern);
                loop = state_.path.slice(index);
                this._normalizeLoop(loop);
                loops.push(loop);
            }
            else {
                index = state_.path.length;
                state_.inPath.set(pattern, index);
                state_.path.push(pattern);
                Array.prototype.push.apply(loops
                            , this._findLoops(state_, pattern.toPatterns));
                state_.path.pop();
                state_.inPath.delete(pattern, state_.path.length);
            }
            state.seen.add(pattern);
        }
        return loops;
    };

    _p._breakLoop = function(loop) {
        var from = loop[loop.length-1]
          , to = loop[0], i
          , toPatterns = from.toPatterns
          ;

        // remove all edges connecting the last patettern with the first
        // it's important to know that there can be more than one edges
        // connecting the patterns, depending on how many instances we
        // want to create.
        // FIXME: instead of removing the edge, it could be a great service
        // to just mark the edge as "don't traverse".
        for(i=toPatterns.length-1;i>=0;i--) {
            // back to front, so lower indexes stay valid
            if(toPatterns[i] === to)
                from.splice(i, 1);
        }
    };

    /**
     * For now loops are broken, by removing one of the looping edges,
     * which is pretty brutal and rather random. There are better but not
     * finished concepts in the making loops work as a kind of finite
     * repetition model.
     */
    _p._handleLoops = function(patterns) {
        var loops = this._findLoops(null, patterns);
        // NOTE: this 'handling' is totally arbitrary, it just breaks
        // the loops at a more or less predictable position
        // no real semantic/understanding is involved!
        loops.forEach(this._breakLoop, this);
    };

    _p.deserializePatterns = function(data) {
        // data array:
        // dataNodes => this is only the node type, without edges :owns === children
        // i.e. Multivers, Glyph, Penstroke etc.
        // we allow cyclic references, thus it can't be important which
        // order we actually have in the data array.
        // :owns edges, however are stored as indexes into the data array.
        var i, l
          , prep = []
          , getPrepIndex = function (index) {
                //jshint validthis:true
                return this[index];
            }.bind(prep)
          , patterns
          ;

        for(i=0,l=data.length;i<l;i++)
            // this really does a
            // Object.create(TypeConstructor.prototype)
            // so that we have all (uninitialized) patterns ready for the
            // second pass.
            prep.push(this._makePattern(data[i][0]));

        for(i=0,l=prep.length;i<l;i++) {
            patterns = data[i][1].map(getPrepIndex);
            this._initPattern(prep[i], patterns);
        }

        return patterns;
        // function PenStrokeCenter() {
        //     Parent.call(this);
        //
        // NOTE: PenStrokeCenter has very strong ideas how it's structure
        //       should be! either we have a kind of a self-check after
        //       a "stupid" deserialize, or, we somehow allow this to
        //       happen!
        //
        //     ALSO: PenstrokeCenter and as such inherited by left and right
        //           is a good candidate to talk about singleton patterns.
        //           mabe, we can just use a weaker concept, like "named"
        //           patterns.
        //           PenStrokeCenter could be registered as a named pattern
        //           and, when serialized, and we have a name, we use it
        //           as well, rather than the numerical index.
        //           Still missing: guaranteed use of the right children
        //           and how they are customly linked in the Node.
        //
        //    SO, some nodes already know what patterns they expect as children
        //        thus, we shouldn't -- for these expected children -- play
        //        the lottery and wait for the children and the edges to appear
        //        in the serialized data.
        //
        //     this.add(new PenStrokeLeft());  // 0
        //     this.add(new PenStrokeLeft()); // 1
        //     Object.freeze(this._children);
        // }
        //     this is actually nice code for a constructor: initializes
        //     the expected children, then freezes this._children!
        //
        //     We can do some metaprogramming trick here: inject the childre
        //     that are expected, but don't initialize them fully yet...
        //
        //     like:
        //
        //
        //     penStrokeLeft = Object.create(PenStrokeLeft.prototype);
        //     penStrokeRight = Object.create(PenStrokeLeft.prototype);
        //     penStrokeCenter = Object.create(PenStrokeLeft.prototype);
        //
        //     this is the actual initialization:
        //     PenStrokeCenter.call(penStrokeCenter, penStrokeLeft, penStrokeRight);
        //
        //     even better:
        //     children = [penStrokeLeft, penStrokeRight]
        //     PenStrokeCenter.call(penStrokeCenter, children);
        //
        //     maybe: => $frozenChildren = ["NodeType.prototype.type:patternName"]
        //     PenStrokeCenter.$frozenChildren = ['left:penStrokeLeft', 'right:penStrokeRight']
        //
        //
        //  there's a semantic in all OMA implementations:
        //  a `Object.freeze(this._children);` in the constructor
        //  makes the constructor responsible for setting the children
        //  no other children can be added anymore.
        //  This is either used for child-less elements or for elements
        //  with a dictionary-like interface (PenStrokeCenter defines `left`
        //  and `right`. BEOM root defines `font` and `scene`.
        //
        //  no matter if the dictionary-style is used when `Object.freeze(this._children)`
        //  was done, we'll also use it as the indicator that the constructor
        //  is responsible for its children and their order.
        //
        //  The $frozenChildren will be added as well
        //  we can pre-create/pre-load all patterns named in $frozenChildren
        //  and we will ensure that _children are frozen if $frozenChildren is used
        //  (so it is not forgotten)
        //
        // another anoying thing:
        //      using: patternName for types with $frozenChildren kind of disturbs
        //             how lower levels can be formed, i.e. if a dict-like
        //             type has a list-like child, the list-like child should
        //             be able to change and thus the tree changes, and thus
        //             $frozenChildren/Object freeze does not create a singleton type
        //      we should rather only use $frozenChildren = ["NodeType.prototype.type"]
        //      without a pattern name.
        //      then, instead of adding the children => inject them into the
        //      constructor and live happily until the singleton concept will
        //      be taken care of.
        //      We will take care of injecting the right types.


       // ['{type}', [1,2,3,4,5]] <= the array are the owned instances!

    };

  // bootstrap without data:


  //this._instanciate();
  //    if(data && data.instance)
  //      this._setInstancesData(data.instance);


  // Create a new Root-Type pattern and use it as Root

  // bootstrap with data:

  // deserializePatterns
  //    loads all patterns
  //    creates all edges :owns
  //
  // pick the first Root-Type pattern as Root
  //    if there is none:
  //        Create a new Root-Type pattern

    _p._setRoot = function(root) {
        if(root.type !== this._rootType)
            throw new OMAError('Can\'t set root of type <' + root.type
                    + '> expected is <'+this._rootType+'>.');
        if(this._root)
            // TODO: implement resetting root or something equivalent,
            // like having multiple roots/trees.
            throw new NotImplementedError('Resetting root is not implemented;');
        this._root = root;
    };

    _p._setInstancesData = function(rootInstance, instancesData) {
        // add data:
        // until now instances have no data: for each entry in the instances
        // data dict:
        //    get the instance by the key (=== index-path)
        //        if there's no instance -> complain and for now just dump the data
        //            later, keep that data and ask the user what to do with it
        //            maybe, that data can at least have a "type" information,
        //            so we can try to integrity check (and warn if type differs)
        //            also, will help the user to recover, when it's known at least
        //            of what type the data was (could also be a fully specified
        //            css-slector, but that would increase the file size a lot)
        //        else
        //          attach the data to the instance
        //          handle id's
        //              -> id's could be rejected, fail gracefully, try to create
        //                 a workaround
        //              -> if the pattern has a recommended id, we should try to
        //                 use it, if rejected, just use none
        //              -> id's can have different sources:
        //                        set by recommendation (to an id or to None)
        //                        set by recommendation but failed thus is None
        //                        set explicitly (to an id or to None)
        //                        set explicitly but failed to apply and got a workaround
        var path, instance, instanceData;

        for(path in instancesData) {
            instance = null;
            try {
                instance = rootInstance.lookupIndexPath(path);
            } catch(e) {
                if(!(e instanceof KeyError))
                    throw e;
                console.warn(e);
            }
            if(!instance)
                continue;
            instanceData = InstanceData.deserializeFromObject(rootInstance
                                , instance.makeProperty, instancesData[path]);
            instance.loadData(instanceData);
        }
    };

    /**
     * returns all instances that got changed.
     * NOTE: this also changes the edges of those instances in their
     * parent.pattern
     *
     * If dryRun is true, this doesn't change the instances, but it returns
     * the instances that would be chaned.
     *
     * After forking a pattern, this method can be used to apply the fork
     * to a cluster of instances. (used to be called "translate")
     * When two patterns have the same essence this can be used to
     * make all instances of one pattern into instances of the other
     * pattern (used to be called "merge");
     *
     * Instances that are affected are the baseInstances cluster and
     * also the baseInstances clusters of pattern edges of affected instances.
     *
     * It does not return child instances that are affected.
     *
     */
    _p.reassign = function(initialInstance, newPattern, dryRun) {
        var instances = [initialInstance]
          , instance, edge
          , seen = new Set()
          , seenEdges = new Set()
          , notSeen = items => [...items].filter(item=>!seen.has(item))
          ;

        while((instance = instances.pop())) {
            if(seen.has(instance) || instance.pattern === newPattern)
                continue;
            seen.add(instance);
            instances.push(...notSeen(instance.getBaseInstancesCluster()));
            edge = instance.parent.pattern.getEdgeByInstance(instance);
            if(!seenEdges.has(edge) && edge.to !== newPattern) {
                // also here filter with
                seenEdges.add(edge);
                if(!dryRun)
                    // FIXME: how to make this a "protected" operation?
                    // just setting a new pattern creates an invalid state
                    edge.to = newPattern;
                instances.push(...notSeen(edge.instances));
            }
            if(!dryRun)
                // parent pattern must conform with this change
                // thus `reassign` is protected from wild use
                instance.pattern = newPattern;
        }
        if(!dryRun)
            // recurse for all descendants of the instances.
            for(instance of seen)
                instance.children.forEach(childInstance => this.reassign(
                    childInstance, instance.pattern.getChild(childInstance.index)
                ));
        return seen;
    };

    /**
     * A clone is *WITHOUT* attached instances.
     */
    _p.clonePattern = function(pattern, dontClone, depth) {
        var depth_ = Number.isFinite(depth)
                        ? depth
                        : Infinity // => default, clone all
          , clone, child, clonedChildren = []
          ;
        // There's not much use in cloning deep frozen types.
        // We should treat them as singletons everywhere.
        if(depth_ <= 0 || (dontClone && dontClone.has(pattern))
                       || pattern.isDeepFrozen)
            return pattern;

        clone = this._makePattern(pattern.type);
        if(clone === pattern)
            // singleton
            return pattern;

        CONTINUE_HERE;
        for(child of pattern.children)
            clonedChildren.push(
                                this.clone(pattern, depth_-1, dontClone));

        this._initPattern(clone, clonedChildren);

        return clone;
    };

    TODO:
    // -> createPattern => integrate this with the deserialization path
    //   (_makePattern, _initPattern etc.) that we already have
    // -> and then finish clonePattern
    // SEE also: addPatterns and how it is hoplessly underspecified, along
    //           with the bloat added by singleton registration etc...
    // -> when noded become plugins, we should be able to swap types
    //    (different nodes with the same type-name, think different versions
    //    for extreme cases!) Thus, all typeName residue in here must be
    //    wiped, along with all instances in the patterns!.


//    Important:
//        - in case of a cyclic sub-tree, we got to mention it in the essence ...
//        - by simply repeating the sub-tree as often as requested, we can do this easily
//        - may be smarter to notate a loop explicitly
//
//
//    FractalElement1 :owns Contour1
//                   :owns Contour2
//                   :owns Contour3
//
//    Contour2 :owns FractalElement2
//
//    FractalElement2 :owns FractalElement2
//    FractalElement2: :owns FractalElement1
//
//    Master :owns FractalElement1
//           :owns FractalElement2
//
//    here are many loops:
//
//    Big Loop
//    Master -> FractalElement1 -> Contour2 -> FractalElement2 -> FractalElement1 -> Contour2 -> FractalElement2 -> FractalElement1
//    Big-Lopp to Small Loop
//    Master -> FractalElement1 -> Contour2 -> FractalElement2 -> FractalElement2
//    Small Loop
//    Master -> FractalElement2 -> FractalElement2
//    Other Big:
//    Master -> FractalElement2 ->  FractalElement1 -> Contour2 -> FractalElement2 -> FractalElement1 -> Contour2 -> FractalElement2
//
//
//    In all these cases, the edge that "actually constitutes the loop" should
//    define the depth, how often the loop will be repeated.
//
//    Oh, this is quite interesting:
//        Big Loop and Other Big have different entry points into the loop
//        but I'd like to have all instances of a pattern to be compatible
//        i.e. to have the same ESSENCE! -> for fancy base mixing
//        It seems like impossible, since the starting points are different
//        thus, the patterns are *not in sync* (out of phase?!)
//    Basically, what I want to have is that the InstanceTrees of the same
//    pattern always have the same shape. but with this kind of circular refs
//    they don't.
//    Maybe a further indicator is needed, i.e. FractalElement2:3 (:2 === depth 3, 3 times repeated)
//    But it's important, that every pattern element in the loop is getting it's own signature
//    that way, and some would not even end at a full loop (self repetiion...).
//    So, we need well defined ideas here!.
//
//    What if we *cut* the moment a recursion becomes apparent?
//
//
//    Big Loop
//    Master -> FractalElement1`0/3 -> Contour2`0/3  -> FractalElement2`0/3
//                -> FractalElement1`1/3 -> Contour2`1/3  -> FractalElement2`1/3
//                -> FractalElement1`2/3 -> Contour2`2/3  -> FractalElement2`2/3
//                XXX STOP XXX-> FractalElement1`3/3 -> Contour2`3/3  -> FractalElement2`3/3
//                XXX STOP XXX don\'t do `x/y x >= y
//    Big-Lopp to Small Loo
//    Master -> FractalElement1 -> Contour2 -> FractalElement2  -> FractalElement2
//    Small Loop
//    Master -> FractalElement2 -> FractalElement2
//    Other Big:
//    Master -> FractalElement2 ->  FractalElement1 -> Contour2 -> (|||) FractalElement2 -> FractalElement1 -> Contour2 -> FractalElement2
//
//
//    FractalElement2 # -> FractalElement1
//    Contour2 -> FractalElement2 # -> FractalElement1
//    FractalElement1 -> Contour2 -> FractalElement2 # -> FractalElement1
//    Master -> FractalElement1 -> ...
//           -> FractalElement2 -> ...
//
//
//    now add FractalElement2 :owns FractalElement1
//    now, the loop manifests in FractalElement1, i.e. when walking up
//    the FractalElement2 -> FractalElement1 edge, all possible edges...
//    we'll find that FractalElement1 is repeating itself, i.e. now
//    FractalElement1 owns itselt.
//    Need to examine all possible routes upwards, it's not important if
//    a pattern is contained in root, it's more important that the traversal
//    ends at some point.
//    Also, because we check one at a time, it'll be just this edge that
//    causes the loop. Other looping are already properly resolved...
//
//
//    What to do:
//        1) disalow creation of this edge
//        2) some smart, limited and controlled repetition :-| dunno how to
//
//    2) ohh so you want to create FractalElement2 :owns FractalElement1
//            but that creates a loop-conflict
//        -> how about to fork FractalElement1 into FractalElement1`1
//        -> and then create that edge there?
//
//    FractalElement2
//    Contour2 -> FractalElement2
//    FractalElement1 -> Contour2 -> FractalElement2
//    Master -> FractalElement1 -> ...
//           -> FractalElement2 -> ...
//
//    FractalElement1`1 = deep-fork FractalElement1
//
//    FractalElement2`1
//    Contour2`1-> FractalElement2`1
//    FractalElement1`1 -> Contour2`1 -> FractalElement2`1
//
//    now:
//
//    FractalElement2 -> FractalElement1`1
//    Contour2 -> FractalElement2 -> FractalElement1`1
//    FractalElement1 -> Contour2 -> FractalElement2 -> FractalElement1`1
//
//    OK, that worked!
//    also, we can repeat it for FractalElement2`1 :owns FractalElement1`1
//                            => FractalElement2`1 :owns FractalElement1`2
//
//    We always deep fork the deepest sub-tree, can't deep fork the initial
//    ones, as they have changed...
//
//    To keep FractalElement1 as the reference allive, it would maybe make
//    sense to always use it as the stop element in a loop.
//
//    so instead of:
//        FractalElement1 -> Contour2 -> FractalElement2 -> FractalElement1`1
//        we should do:
//
//    FractalElement1`1 -> Contour2`1 -> FractalElement2`1 -> FractalElement1
//
//    and then  FractalElement1 remains unchanged.
//
//    FractalElement2
//    Contour2 -> FractalElement2
//    FractalElement1 -> Contour2 -> FractalElement2
//    Master -> FractalElement1 -> ...
//           -> FractalElement2 -> ...
//
//
//    add: FractalElement2 :owns FractalElement1
//
//    FractalElement1`1 = deep-fork FractalElement1
//
//    =>
//    FractalElement2`1
//    Contour2`1-> FractalElement2`1
//    FractalElement1`1 -> Contour2`1 -> FractalElement2`1
//
//    add: FractalElement2`1 :owns FractalElement1
//
//    FractalElement2`1 -> FractalElement1
//    =>
//    FractalElement2`1 -> FractalElement1
//    Contour2`1-> FractalElement2`1 -> FractalElement1
//    FractalElement1`1 -> Contour2`1 -> FractalElement2`1 -> FractalElement1
//
//    Master -> FractalElement1 -> ...
//           -> FractalElement2 -> ...
//           -> FractalElement1`1 -> ... -> FractalElement1
//
//
//    We probably want the instances-(data) stick to the left side, so,
//    got to move instances around each time a depth is changed ?
//    if that is even practical ... later
//
//    Should we automatically replace all reference to FractalElement1
//    with references to FractalElement1`max?
//
//    Maybe, it is best if we refuse to link to anyting else than FractalElement1`max
//    -- of course, instance bases could -- but not :owns edges.
//
//    it is hard to imagine how the cyclic :owns edge creates all these
//    derrived patterns and keeps them under control.
//
//
//
//    The magic that we need here is that the derrived elements somehow
//    sync with their sources. I.e. they repeat the changes done to their
//    sources.
//    Ideally, they also cannot be changed by themselves, all changes must
//    be done to the originals. So that deep-fork becomes kind of intransparent
//    as an interface.
//
//    so, we detect a cyclic reference, and instead of disallowing it, we
//    ask how often it should repeat an intransparent deep-fork
//    that information is part of the cyclic-:owns-Edge
//
//    everything you do to FractalElement1 also happens to FractalElement1`n
//
//    create a Contour3
//    add FractalElement1 :owns Contour3
//        for each FractalElement1`n
//            add FractalElement1`n :owns Contour3
//
//    if I change the depth of a cyclic edge, it should also be reflected
//    immediately, and add/remove derived elements (we already know this is
//    a cyclic edge and we handle it, how often we repeat shouldn nott be relevant,
//    the only relevant thing is that it is finite.
//
//
//
//
//
//
//    So, this is not to do in a naive way !
//    Thus, how about this:
//        -> we don't ever allow the creation of cyles
//        -> instead, we allow repetition of a pattern in itself (depth) for a `limited` amount
//        -> and we can somehow proof that this is not the same
//            -> repetition would probably mean to create an `extra` (virtual?)
//               pattern for each round
//            -> this also means an extra pattern for eache repeated pattern within the repeted pattern ...
//            -> afterall, it may look like a circular reference, the special edge (defined that way?)
//               but rather than repeating the pattern itself, it repeats copies with one rep less each
//               revolution.
//            -> thus, we can rest assured that there are indeed distinct patterns for each sub-tree
//
//    -> before we add an edge, we need to make sure that it doesn't create an infinite loop!
//    -> self repetition -> special kind of edge that
//                A) initiates the repetition
//                B) marks also where to subsquently attach the repetition
//                C) is invisible in the last leave (disappers)
//
//    SO -> how does this work?
//
//
//    FractalElement2 :owns FractalElement2 <- easy
//
//
//    Master :owns GlyphElipsis
//    GlyphElipsis :owns GlyphDot
//    // this is the most direct version of a cycle
//    // there can be also bigger circles, and these can themselves contain circles
//    GlyphElipsis :owns GlyphElipsis // depth 2 ... ? because 0 is @ Master :owns GlyphElipsis
//
//    -> GlyphElipsis @ Master :owns GlyphElipsis [0] len 1
//        -> GlyphDot @ GlyphElipsis :owns GlyphDot [0] len 1
//
//        entering loop here
//
//        -> GlyphElipsis @ GlyphElipsis :owns GlyphElipsis [0] len 1
//                -> GlyphDot @ GlyphElipsis :owns GlyphDot [1] len 2
//                -> GlyphElipsis @ GlyphElipsis :owns GlyphElipsis [1] len 2
//                    -> GlyphDot @ GlyphElipsis :owns GlyphDot [2] len 3
//                    XXX STOP XXX -> GlyphElipsis @ GlyphElipsis :owns GlyphElipsis [2] len 3
//                    XXX STOP XXX maxDepth == 2 but len would be 3
//

    _p._instanciate = function() {
        // build instances
        // from root
        //    create a special instance for Root (the root instance has no parent,
        //    it is the root) walk the tree, for each :owns edge create one instance
        //
        //    (NOT AVAILABLE NOW
        //      for circular-patterns -> got special depth parameter deep
        //        1-depth (1 repetition) as a default, so it appears in the app
        //        but it's not too deep to be performance heavy, we'll be able
        //        to tune this number for each circular.
        //        Root -> 0 depth -> is there a point to repeat root? how should
        //        the app react? Feels save to not allow this at the beginning.
        //      so, for circular references, we'll actually use the :own edge
        //      multiple times, thus a instance is better stored in an array
        //      and the length of the array (-1) equals the depth of the recursion
        //    )
        //
        //    properly link all the child instances to their parents
        //        -> that's it instance tree is build, we can attach the root
        //           instance to a CPSController

        // the question is if this injects the parent/root API into instance
        // This would mean there's no need for a special _root node anymore
        // and the application can freely use any node as root node.
        // feels much more versatile than the status quo.
        var rootInstance = Object.create(Instance.prototype);
        this._controller = new CPSController(ruleController, rootInstance, selectorEngine);
        Instance.call(rootInstance, this._root, new RootAPI(this._controller));
        return rootInstance;// instanceTree root
    };

    _p.bootstrap = function(data/*optional*/) {
        var patterns = null
          , root = null
          , RootType
          , i, l
          , rootInstance
          ;
        if(data && data.patterns) {
            patterns = this.deserializePatterns(data.patterns);
            for(i=0,l=patterns.length;i<l;i++) {
                // just pick the first
                FIXME; // add extra info data.roots: [index, index, ...]
                // picking is stupid now, since multiple roots will
                // be possible, as well as different types.
                if(patterns[i].type === this._rootTypeName) {
                    root = patterns[i];
                    break;
                }
            }
        }

        if(patterns === null)
            patterns = [];

        if(root === null) {
            RootType = this._getNodeType(this._rootTypeName);
            root = new RootType();
            // by default, this is the first node:
            patterns.push(root);
        }

        this.addPatterns(patterns);
        // needs a 'indexID' to normalize loops
        this._handleLoops(patterns);
        this._setRoot(root);

        rootInstance = this._instanciate();
        if(data && data.instances)
            this._setInstancesData(rootInstance, data.instances);

      // now, instance tree should be useable with CPS!
      //...
    };

    return OMAController;
});
