import { distance } from './utils.js';

export default class TrimbarsDrawer {
    leftTrimBar = {
        x: 0,
        color: "rgba(255, 50, 50, 0.95)",
        selected: false,
        dragged: false
    }
    rightTrimBar = {
        x: 0,
        color: "rgba(255, 50, 50, 0.95)",
        selected: false,
        dragged: false
    }

    constructor(canvas, leftTrimBarX, rightTrimBarX) {
        this.canvas = canvas;
        this.leftTrimBar.x = leftTrimBarX;
        this.rightTrimBar.x = rightTrimBarX;
        this.ctx = canvas.getContext('2d');
    }

    // Clear the canvas
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    draw() {
        let ctx = this.ctx;

        // Good practice: always save the context state before drawing
        ctx.save();


    ctx.lineWidth = 4;

        ctx.strokeStyle = this.leftTrimBar.color;
        ctx.beginPath();
        // start
        ctx.moveTo(this.leftTrimBar.x, 0);
        ctx.lineTo(this.leftTrimBar.x, this.canvas.height);
        ctx.stroke();

        // end
        ctx.beginPath();
        ctx.strokeStyle = this.rightTrimBar.color;
        ctx.moveTo(this.rightTrimBar.x, 0);
        ctx.lineTo(this.rightTrimBar.x, this.canvas.height);
        ctx.stroke();

    // triangle start (larger)
    ctx.fillStyle = this.leftTrimBar.color;
    ctx.beginPath();
    ctx.moveTo(this.leftTrimBar.x, 0);
    ctx.lineTo(this.leftTrimBar.x + 14, 10);
    ctx.lineTo(this.leftTrimBar.x, 22);
    ctx.fill();

    // triangle end (larger)
    ctx.beginPath();
    ctx.fillStyle = this.rightTrimBar.color;
    ctx.moveTo(this.rightTrimBar.x, 0);
    ctx.lineTo(this.rightTrimBar.x - 14, 10);
    ctx.lineTo(this.rightTrimBar.x, 22);
    ctx.fill();

        // We draw grey transparent rectangles before leftTrimBar and after rightTrimBar
        ctx.fillStyle = "rgba(128, 128, 128, 0.7)"
        ctx.fillRect(0, 0, this.leftTrimBar.x, this.canvas.height);
        ctx.fillRect(this.rightTrimBar.x, 0, this.canvas.width, this.canvas.height);

        // Good practice: always restore the context state after drawing
        ctx.restore();
    }

    highLightTrimBarsWhenClose(mousePos) {
        // compute distance between mousePos and left trim pos
        // increase hit-area offsets slightly to make selection easier
        let d = distance(mousePos.x, mousePos.y, this.leftTrimBar.x + 8, 8);

        // If we are close to a trim bar and the other trim bar is not selected,
        // we change its color and set its selected property to true
        if ((d < 16) && (!this.rightTrimBar.selected)) {
            this.leftTrimBar.color = "yellow";
            this.leftTrimBar.selected = true;
        } else {
            this.leftTrimBar.color = "rgba(255, 50, 50, 0.95)";
            this.leftTrimBar.selected = false;
        }

        // same for the right trim bar
        d = distance(mousePos.x, mousePos.y, this.rightTrimBar.x - 8, 8);
        if ((d < 16) && (!this.leftTrimBar.selected)) {
            this.rightTrimBar.color = "yellow";
            this.rightTrimBar.selected = true;
        } else {
            this.rightTrimBar.color = "rgba(255, 50, 50, 0.95)";
            this.rightTrimBar.selected = false;
        }
    }

    startDrag() {
        // if a trim bar is selected, we set its dragged property to true
        if (this.leftTrimBar.selected)
            this.leftTrimBar.dragged = true;

        if (this.rightTrimBar.selected)
            this.rightTrimBar.dragged = true;
    }

    stopDrag() {
        // Called when the mouse is released, we stop dragging the trim bars
        // if they were being dragged
        if (this.leftTrimBar.dragged) {
            this.leftTrimBar.dragged = false;
            this.leftTrimBar.selected = false;

            // We limit the left trim bar to stay on the left of the right trim bar
            // (sometimes, if the mouse moves too fast, we can be on the right of the right trim bar)
            if (this.leftTrimBar.x > this.rightTrimBar.x)
                this.leftTrimBar.x = this.rightTrimBar.x;
        }

        if (this.rightTrimBar.dragged) {
            this.rightTrimBar.dragged = false;
            this.rightTrimBar.selected = false;

            // We limit the right trim bar to stay on the right of the left trim bar
            // (sometimes, if the mouse moves too fast, we can be on the left of the left trim bar)
            if (this.rightTrimBar.x < this.leftTrimBar.x)
                this.rightTrimBar.x = this.leftTrimBar.x;
        }
    }


    moveTrimBars(mousePos) {
        // When the mouse moves, we check if we are close to a trim bar
        // If so: change its color and set its selected property to true
        this.highLightTrimBarsWhenClose(mousePos);

        // We limit the trim bars to stay in the canvas
        if (mousePos.x <= 0) {
            this.leftTrimBar.x = 0;
        }
        if (mousePos.x >= this.canvas.width) {
            this.rightTrimBar.x = this.canvas.width;
        }

        if (this.leftTrimBar.dragged) {
            // We limit the left trim bar to stay on the left of the right trim bar
            if (this.leftTrimBar.x < this.rightTrimBar.x)
                this.leftTrimBar.x = mousePos.x;
            else {
                if (mousePos.x < this.rightTrimBar.x)
                    this.leftTrimBar.x = mousePos.x;
            }
        }

        if (this.rightTrimBar.dragged) {
            // We limit the right trim bar to stay on the right of the left trim bar
            if (this.rightTrimBar.x > this.leftTrimBar.x)
                this.rightTrimBar.x = mousePos.x;
            else {
                if (mousePos.x > this.rightTrimBar.x)
                    this.rightTrimBar.x = mousePos.x;
            }
        }
    }
}
