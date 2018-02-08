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
    function OMAController(CPSController, TreeNodesTypes, ruleController) {
        this.CPSController = CPSController;
        // shared across all roots.
        this._ruleController = ruleController;

        this._roots = []; // array of rootInstance (=like documents?)

        this._nodeTypes = new Map(); // typeName => NodeTypeConstructor
        TreeNodesTypes.forEach(this.addNodeType, this);

        // TODO: when node types become plugins, we should be able to swap types
        //    (different nodes with the same type-name, think different versions
        //    or implementations for extreme cases or just a user trying out
        //    node types) Thus, all typeName residue in here must be
        //    wiped, along with all instances in the patterns!.


        this._singletons = new Map(); // typeName => instance
        this._singletonTypes = new Map(); // typeName => boolean
        this._initialized = new WeakSet();
        // instances of NodeTypes are patterns
        // these patterns also have the :owns edges set
        // other datastructure or do we need this at all?
        this._patterns = [];
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
    _p._addPattern = function(pattern) {
        if(!this._nodeTypes.has(pattern.type))
            throw new OMAError('NodeType of pattern "' + pattern.type
                    + ' is not registered. See: addNodeType');
        // TODO: the pattern must be an instance of the registered NodeType.
        // maybe store differently?
        this._patterns.push(pattern);
    };

    _p._getNodeType = function(typeName) {
        var Constructor = this._nodeTypes.get(typeName);
        if(!Constructor)
            throw new KeyError('A NodeType is missing "' + typeName + '"');
        return Constructor;
    };

    /**
     * This is *very* similar to pattern.isDeepFrozen but it works
     * without initialized types and it predicts/expects behavior
     * rather than reporting the actual facts. Nevertheless, this and
     * pattern.isDeepFrozen should not contradict, once the pattern is
     * fully initialized!
     */
    _p.typeIsSingleton = function(typeName, checking) {
        var Constructor, childTypeName
            // results are cached
          , isSingleton = this._singletonTypes.get(typeName)
          ;
        if(typeof isSingleton === 'boolean')
            return isSingleton;


        // create the cache entry
        Constructor = this._getNodeType(typeName);
        if(!Constructor.$frozenChildren)
            isSingleton = false;
        else {
            // Hell breaks loose if a frozen type (or a descendant)
            // defines itself as a child type dependency!
            // Then this.typeIsSingleton is called in a loop.
            let checking_ = checking ? checking : new Set();
            if(checking_.has(typeName))
                throw new OMAError('Circular dependency in  '
                                 + 'frozen type definition: ' + typeName);
            checking_.add(typeName);
            isSingleton = true;
            for(childTypeName of Constructor.$frozenChildren) {
                if(this.typeIsSingleton(childTypeName, checking_))
                    continue;
                isSingleton = false;
                break;
            }
            checking_.delete(typeName);
        }
        this._singletonTypes.set(typeName, isSingleton);
        return isSingleton;
    };

    _p._makePattern = function(typeName) {
        var Constructor
          , pattern = this._singletons.get(typeName)
          ;
        if(pattern)
            // already created singleton
            return pattern;
        Constructor = this._getNodeType(typeName);
        pattern = Object.create(Constructor.prototype);
        if(this.typeIsSingleton(typeName))
            this._singletons.set(typeName, pattern);
        this._addPattern(pattern);
        return pattern;
    };

    _p._initPattern = function(pattern, children) {
        var Constructor = pattern.constructor;
        // don't init the same pattern twice
        if(this._initialized.has(pattern))
            throw new OMAError('The pattern ' + pattern + ' is already initiated');
        this._initialized.add(pattern);

        Object.defineProperty(pattern, 'omaController', {
            value:this
        })

        if(Constructor.$frozenChildren) {
            // At this point all children-patterns must already be
            // initialized!!! This is because we need the `on` subscription
            // to be available now!
            Constructor.apply(pattern, children);
            assert(pattern.isFrozen, 'Constructors that define $frozenChildren '
                                        + 'must freeze their `_edges` array');
        }
        else {
            Constructor.call(pattern);
            // assert pattern.childrenLength === 0
            pattern.insertAt(0, children);
        }
    };

    /**
     * A clone is *WITHOUT* attached instances.
     */
    _p.clone = function(pattern, {depth, dontClone}={}) {
        var depth_ = Number.isFinite(depth)
                        ? depth
                        : Infinity // => default, clone all
          , clone, options, clonedChildren
          ;

        if(depth_ <= 0 || (dontClone && dontClone.has(pattern)))
            return pattern;

        clone = this._makePattern(pattern.type);
        if(clone === pattern)
            // a singleton
            return pattern;

        options = {depth:depth_-1, dontClone:dontClone};
        clonedChildren = pattern.children.map(child=>this.clone(child, options));
        this._initPattern(clone, clonedChildren);
        return clone;
    };

    _p.createPattern = function(typeName) {
        var pattern = this._makePattern(typeName)
          , Constructor = pattern.constructor
          , children = []
          ;
        if(this._initialized.has(pattern))
            // i.e. a singleton
            return pattern;

        // the pattern is new!
        children = Constructor.$frozenChildren
            // recursive!
            ? Constructor.$frozenChildren.map(this.createPattern, this)
            : []
            ;
        this._initPattern(pattern, children);
        return pattern;
    };

    /**
     * data = [
     *      'typeName1', [/indexes of dependencies in data/]
     *    , 'typeName2', [0]
     *    , 'typeName3', [1, 0]
     *    ...
     * ]
     */
    function topoSortSerialized(data) {
        var deps = data.map(item=>item[1])
          , sorted = _topoSort(deps)
          ;
        return sorted.map(i=>data[i]);
    }

    /**
     * This very generic.
     *
     * data is a list of lists;
     *
     * data = [
     *      [/indexes of dependencies in data/]
     *    , [0]
     *    , [1, 0]
     *    ...
     * ]
     *
     * Each element in data is a node, the index in data is the id of the node.
     *
     * A node is represented by a list of dependencies(ids/indexes) of other
     * nodes in data;
     *
     * returns the topological order of indexes in data
     */
    function _topoSort(data) {
        var result = []
          , clear = new Set()
          , indexes = data.map((_,i)=>i)
          , startlen, i, index
          , filterCleared = index=>!clear.has(index)
          ;

        // sanity check if all dependencies exist
        data.forEach(function checkDeps (deps, i) {
            deps.forEach(idx=>{
                if(idx<0 || idx>=data.length || isNaN(idx))
                    throw new OMAError('Item at ' + i
                            + ' has depenedency out of range: ' + idx);
            });
        });

        while(indexes.length) {
            startlen = indexes.length;
            for(i=indexes.length-1;i>=0;i--) {
                index = indexes[i];
                // remove all references which are already resolved
                data[index] = data[index].filter(filterCleared);
                if(data[index].length)
                    // still has dependencies
                    continue;
                clear.add(index);
                result.push(index);
                indexes.splice(i, 1);
            }
            if(indexes.length === startlen)
                throw new OMAError('Cyclic dependencies, can\'t resolve '
                                            + 'entries: ' + indexes);
        }
        return result;
    }

    _p.deserializePatterns = function(data) {
        var index
          , created = []
          , getCreatedIndex = index => {
                // assert(created[index]!==undefined
                //        , 'index must exist (use topological ordering)')
                return created[index];
            }
            // We must have all descendants initialized BEFORE the actual
            // pattern is initialized!
          , topological = topoSortSerialized(data)
          ;

        for(index of topological) {
            let [typeName, dependencies] = data[index]
              , pattern = this._makePattern(typeName)
              ;
            created[index] = pattern;
            if(this._initialized.has(pattern))
                // This happens if a singleton was created before.
                // I.e. there were patterns before this execution
                // of deserializePatterns.
                continue;
            let patterns = dependencies.map(getCreatedIndex);
            // assert: all items in patterns must be in this._initialized
            // (because of the topological order)
            this._initPattern(pattern, patterns);
        }
        return created;
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
                // this is
                console.warn('Can\'t set some instance data:', e);
            }
            if(!instance)
                continue;
             try {
                instanceData = InstanceData.deserializeFromObject(rootInstance
                                , instance.makeProperty, instancesData[path]);
            } catch(e) {

                console.warn('Can\'t deserialize instance data for'
                                                    , path, 'with:', e);
            }
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
        if(!dryRun) {
            let reassignChild = child => {
                return this.reassign(child
                        , child.parent.pattern.getChild(child.index));
            };
            // recurse for all descendants of the instances.
            for(instance of seen)
                instance.children.forEach(reassignChild);
        }
        return seen;
    };


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

    _p._instanciateRoot = function(rootPattern) {
        // build instances
        // from root
        //    create a special instance for Root (the root instance has no parent,
        //    it is the root) walk the tree, for each :owns edge create one instance
        //
        //    (NOT AVAILABLE NOW AND NEVER LIKE THIS
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
        //           instance to a 	CPSController
        var rootInstance = Object.create(Instance.prototype)
          , controller = new this.CPSController(this._ruleController, rootInstance)
          ;
        Instance.call(rootInstance, rootPattern, new RootAPI(controller), null);
        this._roots.push(rootInstance);
        return rootInstance;
    };

    _p.bootstrap = function(data/*optional*/) {
        var patterns
          , patternIndex, instancesData, rootPattern, rootInstance
          ;

        patterns = (data && data.patterns)
                ? this.deserializePatterns(data.patterns)
                : []
                ;

        if(!data.roots) return;
        // data.roots: [
        //      [index, instancesData]
        //    , [index, instancesData]
        //    , [index, instancesData]
        // ];
        for ([patternIndex, instancesData] of data.roots) {
            // TODO: handle assertion error more gracefully; UI must give
            // directions. The data may be of value for the user.
            // But `data` is incomplete/invalid.
            assert(patterns[patternIndex] !== undefined
                                            , 'Root index must exist');
            rootPattern = patterns[patternIndex];
            rootInstance = this._instanciateRoot(rootPattern);
            this._setInstancesData(rootInstance, instancesData);

        }
        // now, the instance trees in this._roots should be useable with CPS!
    };

    _p.createAsRoot = function(typeName) {
        var rootPattern = this.createPattern(typeName);
        // returns rootInstance
        return this._instanciateRoot(rootPattern);
    };

    return OMAController;
});
