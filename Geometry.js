define([

],
function()
{

    function Geometry() {

    }
    var _p = Geometry.prototype;

    /**
     * Get control point vectors from (MOM Point) StyleDicts.
     * try to use hobby splines but fall back to the control point values
     * of the points if hobbys would fail when there are no good tensions
     * or directions.
     *
     * The terminal parameter is a switch used to draw the penstroke terminals
     * for the start terminal of the stroke all controls are from the incoming
     * control points. p0 in in p1
     * for the end terminal of the stroke all controls are from the outgoing
     * control points. p0 out out p1
     * Without terminal beeing set or having a value of "start" or "end"
     * the default behavior is: p0 out in p1
     *
     * See the comment of drawPenstrokeToPointPen for more detail.
     */
    _p.getControlsFromStyle = function (p0, p1, terminal) {
        return [
              p0.get(terminal === 'start' ? 'in': 'out')
            , p1.get(terminal === 'end' ? 'out' :'in')
        ];
    };

    /**
     * The translation from Metapolator Penstrokes to Outlines:
     *
     * The example uses a penstroke with 7 points indexed from 0 to 6
     *
     *  Penstroke       Outline
     *
     *  ending
     *  terminal
     *    ___              7___
     *   | 6 |           8 |   | 6
     *   | 5 |           9 |   | 5
     *   | 4 |          10 |   | 4
     *   | 3 |          11 |   | 3
     *   | 2 |          12 |   | 2
     *   |_1_|          13 |___| 1
     *     0                 14/0
     *  starting
     *  terminal
     *
     *
     *
     * We draw first the right side from 0 to 6,
     * then the left side from 6 to 0.
     *
     * In each iteration only one on-curve point is drawn; in the
     * following example, that is always the last point of the four-
     * point tuples. Also, the out and in controls are drawn.
     * The first point of the tuples is needed to calculate the control
     * point position when we use hobby splines.
     *
     * for i=0;i<n;i++;
     *      i===0:
     *          //starting terminal segment:
     *          on0.left in in on0.right
     *              => out in 0
     *      i!==0:
     *          // segments right side:
     *          // here i=1
     *          on0.right out in on1.right
     *              => out in 1
     * for i=n-1;i>0;i--;
     *      i===n-1
     *          // ending terminal segmnet
     *          // here i=6
     *          on6.right out out on6.left
     *              => out in 7
     *      i!===n-1
     *          // segments left side
     *          // here i=5
     *          on6.left in out on5.left
     *              => out in 8
     */
    _p.renderPenstrokeOutline = function ( pen, model, penstroke ) {
        var points = penstroke.children
          , point
          , prePoint
          , segmentType, terminal, ctrls
          , i,l
          ;

        pen.beginPath();
        // first draw the right side
        for(i=0,l=points.length;i<l;i++) {
            point = model.getComputedStyle(points[i].right);
            // Actually, all points have controls. We don't have to draw
            // lines. We should make a CPS value if we want to draw a
            // point as a line segment point
            if(true /* always curve */) {
                segmentType = 'curve';
                if(i === 0) {
                    // this reproduces the starting terminal
                    prePoint = model.getComputedStyle(points[i].left);
                    terminal = 'start';
                }
                else {
                    terminal = false;
                    prePoint = model.getComputedStyle(points[i-1].right);
                }
                ctrls = this.getControlsFromStyle(prePoint, point, terminal);
                /* yield */ pen.addPoint(ctrls[0].valueOf(), undefined, undefined, undefined);
                /* yield */ pen.addPoint(ctrls[1].valueOf(), undefined, undefined, undefined);
            }
            else {
                segmentType =  'line';
                console.warn('implicit line segment, right side, this should be explicit in CPS');
            }
            /* yield */ pen.addPoint(point.get('on').valueOf(), segmentType, undefined, undefined);
        }
        // draw the left side
        for(i=l-1;i>=0 ;i--) {
            point = model.getComputedStyle(points[i].left);
            if(true/*always curve*/) {
                segmentType = 'curve';
                if(i === l-1) {
                    // this reproduces the ending terminal
                    terminal = 'end';
                    prePoint = model.getComputedStyle(points[i].right);
                }
                else {
                    terminal = false;
                    // the left side is of the outline is drawn from the
                    // end to the beginning. This reverses the point order
                    // for getComputedStyle
                    prePoint = point;
                    point = model.getComputedStyle(points[i+1].left);
                }
                ctrls = this.getControlsFromStyle(prePoint, point, terminal);
                if(!terminal) {
                    // reverse on curve and of curve points, prePoint
                    // is no longer needed.
                    ctrls.reverse();
                    point = prePoint;
                }
                /* yield */ pen.addPoint(ctrls[0].valueOf(), undefined, undefined, undefined);
                /* yield */ pen.addPoint(ctrls[1].valueOf(), undefined, undefined, undefined);
            }
            else {
                segmentType = 'line';
                console.warn('implicit line segment, left side, this should be explicit in CPS');
            }
            /* yield */ pen.addPoint(point.get('on').valueOf(), segmentType, undefined, undefined);
        }
        pen.endPath();
    };

    _p.renderContour = function ( pen, model, contour ) {
        var points = contour.children
          , point
          , segmentType
          , i, l
          ;
        pen.beginPath();
        for(i=0, l=points.length;i<l;i++) {
            point = model.getComputedStyle(points[i]);
            // Actually, all points have controls. We don't have to draw
            // lines. We should make a CPS value if we want to draw a
            // point as a line segment point
            if(true /* always curve */) {
                segmentType = 'curve';
            }
            else {
                segmentType =  'line';
            }
            /* yield*/ pen.addPoint(point.get('in').valueOf(), undefined, undefined, undefined);
            /* yield*/ pen.addPoint(point.get('on').valueOf(), segmentType, undefined, undefined);
            /* yield*/ pen.addPoint(point.get('out').valueOf(), undefined, undefined, undefined);
        }
        pen.endPath();
    };

    _p.renderPenstrokeCenterline = function ( pen, model, penstroke ) {
        var points = penstroke.children
          , point
          , prePoint
          , segmentType, ctrls
          , i, l
          ;
        // center line
        pen.beginPath();
        for(i=0,l=points.length;i<l;i++) {
            point = model.getComputedStyle(points[i].center);
            if(i !== 0) {
                segmentType = 'curve';
                prePoint = model.getComputedStyle(points[i-1].center);
                ctrls = this.getControlsFromStyle(prePoint, point);
                /* yield */ pen.addPoint(ctrls[0].valueOf(), undefined, undefined, undefined);
                /* yield */ pen.addPoint(ctrls[1].valueOf(), undefined, undefined, undefined);
            }
            else
                // this contour is not closed, the first point is a move
                segmentType = 'move';
            /* yield */ pen.addPoint(point.get('on').valueOf(), segmentType, undefined, undefined);
        }
        pen.endPath();
    };

    return Geometry;
});
