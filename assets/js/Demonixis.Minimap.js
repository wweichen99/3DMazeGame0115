var Demonixis = window.Demonixis || {};
Demonixis.Gui = Demonixis.Gui || {};

Demonixis.Gui.MiniMap = function(width, height, parent) {
    this.parent = parent;
    this.width = width;
    this.height = height;
    this.blockSize = {
        width: 5,
        height: 5
    };

    this.playerPosition = {
        x: 0,
        y: 0
    };

    this.miniMap = document.createElement("canvas");
    this.ctx = this.miniMap.getContext("2d");

    this.create = function(top, left, position, border) {
        var stylePosition = "position:absolute;";
        var styleTop = (top || "10") + "px;";
        var styleLeft = (left || "10") + "px;";
        var styleBorder = (border || "1px solid black") + ";";

        this.miniMap.setAttribute("width", this.width * this.blockSize.width);
        this.miniMap.setAttribute("height", this.height * this.blockSize.height);
        this.miniMap.setAttribute("id", "miniMap");
        this.miniMap.setAttribute("style", stylePosition + "top:" + styleTop + "left:" + styleLeft + styleBorder);

        var domElement = document.getElementById(this.parent);
        if (domElement[0] != "undefined") {
            domElement.removeChild[domElement[0]];
        }
        domElement.appendChild(this.miniMap);
    };

    /**
     * 已修改：将终点颜色改为绿色，并添加文字标记
     */
    this.draw = function(x, y, id) {
        if (id == 1) {
            this.ctx.fillStyle = "white";
        } else if (id == 'D') {
            this.ctx.fillStyle = "red";
            this.playerPosition = {
                x: x,
                y: y
            };
        } else if (id == 'J') {
            this.ctx.fillStyle = "yellow"; // 修复原代码拼写错误 (fillStype -> fillStyle)
        } else if (id == 'A') {
            this.ctx.fillStyle = "#2ecc71"; // 已修改：蓝色改为绿色以匹配终点标记
        } else {
            this.ctx.fillStyle = "rgb(200, 200, 200)";
        }

        this.ctx.fillRect(x * 5, y * 5, 5, 5);
        
        // 如果是终点，绘制一个小型标记文字 "E"
        if (id == 'A') {
            this.ctx.fillStyle = "white";
            this.ctx.font = "bold 4px Arial";
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText("E", x * 5 + 2.5, y * 5 + 2.5);
        }
    };

    this.update = function(newPlayerPosition) {
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(this.playerPosition.x * this.blockSize.width, this.playerPosition.y * this.blockSize.height, this.blockSize.width, this.blockSize.height);
        this.ctx.fillStyle = "red";
        this.ctx.fillRect(newPlayerPosition.x * this.blockSize.width, newPlayerPosition.y * this.blockSize.height, this.blockSize.width, this.blockSize.height);
        this.playerPosition = newPlayerPosition;
    };

    this.drawAt = function(x, y, color) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x * this.blockSize.width, y * this.blockSize.height, this.blockSize.width, this.blockSize.height);
    };
};