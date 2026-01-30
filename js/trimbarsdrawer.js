import { distance } from './utils.js';

// Classe pour gérer l'affichage et l'interaction des barres de trim (découpe audio)
export default class TrimbarsDrawer {
    // Barre de trim de gauche (début)
    leftTrimBar = {
        x: 0,
        color: "rgba(255, 50, 50, 0.95)",
        selected: false,
        dragged: false
    }
    // Barre de trim de droite (fin)
    rightTrimBar = {
        x: 0,
        color: "rgba(255, 50, 50, 0.95)",
        selected: false,
        dragged: false
    }

    // Initialise le drawer avec le canvas et les positions initiales des barres
    constructor(canvas, leftTrimBarX, rightTrimBarX) {
        this.canvas = canvas;
        this.leftTrimBar.x = leftTrimBarX;
        this.rightTrimBar.x = rightTrimBarX;
        this.ctx = canvas.getContext('2d');
    }

    // Efface le canvas
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Dessine les barres de trim et les zones désactivées
    draw() {
        let ctx = this.ctx;

        // Bonne pratique : sauvegarde l'état du contexte avant de dessiner
        ctx.save();

        // Dessine les lignes verticales des barres
        ctx.lineWidth = 4;

        ctx.strokeStyle = this.leftTrimBar.color;
        ctx.beginPath();
        // Ligne gauche (début)
        ctx.moveTo(this.leftTrimBar.x, 0);
        ctx.lineTo(this.leftTrimBar.x, this.canvas.height);
        ctx.stroke();

        // Ligne droite (fin)
        ctx.beginPath();
        ctx.strokeStyle = this.rightTrimBar.color;
        ctx.moveTo(this.rightTrimBar.x, 0);
        ctx.lineTo(this.rightTrimBar.x, this.canvas.height);
        ctx.stroke();

        // Triangle en haut de la barre gauche (repère visuel)
        ctx.fillStyle = this.leftTrimBar.color;
        ctx.beginPath();
        ctx.moveTo(this.leftTrimBar.x, 0);
        ctx.lineTo(this.leftTrimBar.x + 14, 10);
        ctx.lineTo(this.leftTrimBar.x, 22);
        ctx.fill();

        // Triangle en haut de la barre droite (repère visuel)
        ctx.beginPath();
        ctx.fillStyle = this.rightTrimBar.color;
        ctx.moveTo(this.rightTrimBar.x, 0);
        ctx.lineTo(this.rightTrimBar.x - 14, 10);
        ctx.lineTo(this.rightTrimBar.x, 22);
        ctx.fill();

        // Remplit les zones avant la barre gauche et après la barre droite (zones inactives)
        ctx.fillStyle = "rgba(128, 128, 128, 0.7)"
        ctx.fillRect(0, 0, this.leftTrimBar.x, this.canvas.height);
        ctx.fillRect(this.rightTrimBar.x, 0, this.canvas.width, this.canvas.height);

        // Bonne pratique : restaure l'état du contexte après avoir dessiné
        ctx.restore();
    }

    // Détecte si la souris est proche d'une barre et la met en évidence
    highLightTrimBarsWhenClose(mousePos) {
        // Calcule la distance entre la souris et la barre gauche
        let d = distance(mousePos.x, mousePos.y, this.leftTrimBar.x + 8, 8);

        // Si proche et l'autre barre n'est pas sélectionnée, mets en évidence
        if ((d < 16) && (!this.rightTrimBar.selected)) {
            this.leftTrimBar.color = "yellow";
            this.leftTrimBar.selected = true;
        } else {
            this.leftTrimBar.color = "rgba(255, 50, 50, 0.95)";
            this.leftTrimBar.selected = false;
        }

        // Même logique pour la barre droite
        d = distance(mousePos.x, mousePos.y, this.rightTrimBar.x - 8, 8);
        if ((d < 16) && (!this.leftTrimBar.selected)) {
            this.rightTrimBar.color = "yellow";
            this.rightTrimBar.selected = true;
        } else {
            this.rightTrimBar.color = "rgba(255, 50, 50, 0.95)";
            this.rightTrimBar.selected = false;
        }
    }

    // Commence à déplacer une barre si elle est sélectionnée
    startDrag() {
        // Marque la barre comme en cours de déplacement
        if (this.leftTrimBar.selected)
            this.leftTrimBar.dragged = true;

        if (this.rightTrimBar.selected)
            this.rightTrimBar.dragged = true;
    }

    // Arrête de déplacer les barres et applique les contraintes
    stopDrag() {
        // Arrête le déplacement et nettoie les états
        if (this.leftTrimBar.dragged) {
            this.leftTrimBar.dragged = false;
            this.leftTrimBar.selected = false;

            // Vérifie que la barre gauche reste à gauche de la barre droite
            if (this.leftTrimBar.x > this.rightTrimBar.x)
                this.leftTrimBar.x = this.rightTrimBar.x;
        }

        if (this.rightTrimBar.dragged) {
            this.rightTrimBar.dragged = false;
            this.rightTrimBar.selected = false;

            // Vérifie que la barre droite reste à droite de la barre gauche
            if (this.rightTrimBar.x < this.leftTrimBar.x)
                this.rightTrimBar.x = this.leftTrimBar.x;
        }
    }

    // Déplace les barres selon la position de la souris
    moveTrimBars(mousePos) {
        // Vérifie si on est proche d'une barre et la met en évidence
        this.highLightTrimBarsWhenClose(mousePos);

        // Maintient les barres dans les limites du canvas
        if (mousePos.x <= 0) {
            this.leftTrimBar.x = 0;
        }
        if (mousePos.x >= this.canvas.width) {
            this.rightTrimBar.x = this.canvas.width;
        }

        // Déplace la barre gauche si elle est en cours de déplacement
        if (this.leftTrimBar.dragged) {
            // Maintient la barre gauche à gauche de la barre droite
            if (this.leftTrimBar.x < this.rightTrimBar.x)
                this.leftTrimBar.x = mousePos.x;
            else {
                if (mousePos.x < this.rightTrimBar.x)
                    this.leftTrimBar.x = mousePos.x;
            }
        }

        // Déplace la barre droite si elle est en cours de déplacement
        if (this.rightTrimBar.dragged) {
            // Maintient la barre droite à droite de la barre gauche
            if (this.rightTrimBar.x > this.leftTrimBar.x)
                this.rightTrimBar.x = mousePos.x;
            else {
                if (mousePos.x > this.rightTrimBar.x)
                    this.rightTrimBar.x = mousePos.x;
            }
        }
    }
}
