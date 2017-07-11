/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

(function ($, d, w) {

    var model = {
        matrix: new Matrix(),
        size: 0, boxWidth: 0,
        Total: [300, 800, 1500, 2500], oldScore: 0, level: 0, progress: 0, score: 0, combo: 0, multiple: 1.3,
        nextColor: new Array(), nextArr: new Array(), nextNum: 3,
        doAnimate: false, boxSelected: null, $table: null,
        $boxtemp: null, $boxClone: null,
        color: {yellow: "yellow", red: "red", blue: "blue", green: "green", purple: "purple"},
        Point: function () {  //坐标点的对象,,可以传入构造函数的参数:Element对象,int x,int y, String color
            if (arguments.length === 2 && model.matrix[arguments[0]][arguments[1]]) {
                return model.matrix[arguments[0]][arguments[1]];
            }
            if (arguments[0] instanceof Element) {
                var $elem = $(arguments[0]);
                this.x = parseInt($elem.attr("data-pointX"));
                this.y = parseInt($elem.attr("data-pointY"));
                this.color = $elem.attr("data-color");
                this.element = arguments[0];
            } else {
                this.x = arguments[0];
                this.y = arguments[1];
                this.color = arguments[2] ? arguments[2] : "none";
                var $td = model.$table.find("td[data-pointx=" + this.x + "][data-pointy=" + this.y + "]");
                this.element = $td[0];
            }
            this.equal = function (point) {
                return this.x === point.x && this.y === point.y;
            };
            this.isNearPoint = function (point) {
                if (this.x === point.x + 1 && this.y === point.y)
                    return true;
                if (this.x === point.x && this.y === point.y + 1)
                    return true;
                if (this.x === point.x && this.y === point.y - 1)
                    return true;
                if (this.x === point.x - 1 && this.y === point.y)
                    return true;
                return false;
            };
        },
        getCurrentScoreDiff: function () {
            if (model.level == 0) {
                return model.Total[model.level];
            } else {
                return model.Total[model.level] - model.Total[model.level - 1]
            }
        }
    };

    function Matrix(arrO) {
        var arr;
        if(arrO == null){
            arr = [new Array(9), new Array(9), new Array(9), new Array(9), new Array(9), new Array(9), new Array(9), new Array(9), new Array(9)];
        }else{
            for (var x = 1; x <= 7; x++) {
                for (var y = 1; y <= 7; y++) {
                    if(arrO[x][y] != null){
                        arrO[x][y] = new model.Point(arrO[x][y].x,arrO[x][y].y,arrO[x][y].color)
                    }
                }
            }
            arr = arrO;
        }
        arr.getSize = function () {
            return model.size;
        };
        arr.setPoint = function (point) {
            this[point.x][point.y] = point;
            model.size++;
        };
        arr.getPoint = function () {//可传递参数:x,y 或 Point
            if (arguments[0] instanceof model.Point) {
                var p = arguments[0];
                return this[p.x][p.y];
            } else {
                var x = arguments[0];
                var y = arguments[1];
                return this[x][y];
            }
        };
        arr.clearPoint = function (point) {
            this[point.x][point.y] = null;
            model.size--;
        };
        arr.genereatMaBool = function () {
            return this.map(function (item, x) { //生成matrix的boolean的数组
                var arr = new Array();
                for (var y = 0; y < item.length; y++) {
                    if (x === 0 || x === item.length - 1 || y === 0 || y === item.length - 1) {
                        arr.push(true);
                    } else {
                        arr.push(!!item[y]);
                    }
                }
                return arr;
            });
        }
        ;
        return arr;
    }

    var view = {
        boxGenerate: function (point, callback) {
//      view.animate.boxGenerate1(point, callback);
            var $td = $(point.element);
            var left = $(point.element).position().left;
            var top = $(point.element).position().top;
            var boxClone = model.$boxtemp.clone();
            boxClone.css({
                left: left + 1,
                top: top + 1,
                height: model.boxWidth - 1 + "px",
                width: model.boxWidth - 1 + "px",
                opacity: .9
            })
                .removeClass().addClass(point.color).show();
            model.$table.parent().append(boxClone);
            boxClone.animate({
                    left: left - 25,
                    top: top - 25,
                    opacity: 0.2,
                    height: model.boxWidth + 50 + "px",
                    width: model.boxWidth + 50 + "px"
                }
                , 120, "easeOutCirc").animate({
                    left: left + 1,
                    top: top + 1,
                    height: model.boxWidth - 1 + "px",
                    width: model.boxWidth - 1 + "px",
                    opacity: .9
                }
                , 120, "easeInCirc", function () {   //回调函数清除动画缓存
                    boxClone.remove();
                    $td.addClass(point.color).attr("data-color", point.color);
                    callback();
                });
        },
        boxMove: function (point, boxSelected, boxPathArr, callback) {
            var color = boxSelected.color;
            model.$boxClone.hide();
            view.clearDisable();
            $(boxSelected.element).removeClass().addClass("clickBox").attr("data-color", "none");
            var boxc = model.$boxtemp.clone();
            boxc.css({height: model.boxWidth - 20 + "px", width: model.boxWidth - 20 + "px", opacity: .9})
                .removeClass().addClass(point.color).addClass("movePath").show();
            boxPathArr.forEach(function (item) {
                var t = boxc.clone();
                var left = $(item.element).position().left;
                var top = $(item.element).position().top;
                t.css({left: left + 10, top: top + 10});
                model.$table.parent().append(t);
            });
            $(".movePath").fadeOut(110, function () {
                $(this).remove();
            });
            var $td = $(point.element);
            var left = $(point.element).position().left;
            var top = $(point.element).position().top;
            var boxClone = model.$boxtemp.clone();
            boxClone.css({
                left: left - 30,
                top: top - 30,
                height: model.boxWidth + 60 + "px",
                width: model.boxWidth + 60 + "px",
                opacity: .2
            })
                .removeClass().addClass(point.color).show();
            model.$table.parent().append(boxClone);
            boxClone.animate({
                    left: left + 1,
                    top: top + 1,
                    height: model.boxWidth - 1 + "px",
                    width: model.boxWidth - 1 + "px",
                    opacity: 1
                }
                , 140, "easeInElastic", function () {   //回调函数清除动画缓存
                    boxClone.remove();
                    $td.addClass(color).attr("data-color", point.color);
                    callback();
                });
        },
        boxClick: function (point) {
            var left = $(point.element).position().left;
            var top = $(point.element).position().top;
            model.$boxClone.css({left: left - 2, top: top - 2})
                .removeClass().addClass(point.color).show();
        },
        boxSuccess: function () {

        },
        clearPoint: function (point) {
            var $td = $(point.element);
            $td.removeClass().addClass("clickBox").attr("data-color", "none");
            var left = $(point.element).position().left;
            var top = $(point.element).position().top;
            var boxClone = model.$boxtemp.clone();
            boxClone.css({
                left: left + 1,
                top: top + 1,
                height: model.boxWidth - 1 + "px",
                width: model.boxWidth - 1 + "px",
                opacity: .9
            })
                .removeClass().addClass(point.color).show();
            model.$table.parent().append(boxClone);
            boxClone.animate({
                    left: left - 25,
                    top: top - 25,
                    opacity: 0.2,
                    height: model.boxWidth + 50 + "px",
                    width: model.boxWidth + 50 + "px"
                }
                , 180, "easeOutQuint", function () {   //回调函数清除动画缓存
                    boxClone.remove();
//         callback();
                });
        },
        boxDisable: function (arr) {
            $(".disable").removeClass().addClass("clickBox");
            arr.forEach(function (item) {
                $(item.element).removeClass().addClass("disable");
            });
        },
        clearDisable: function () {
            $(".disable").removeClass().addClass("clickBox");
        },
        levelUp: function (num) {
            $(".progress-bar").attr("aria-valuenow", num).attr("aria-valuemax", model.Total[model.level]).css("width", 0);
            $(".progress-bar span").text(model.level+1)
        },
        progressUp: function (num) {
            $(".progress-bar").attr("aria-valuenow", num).css("width", num / model.getCurrentScoreDiff() * 100 + "%");
        },
        scoreUp: function (num) {
            $("#score strong").text(num);
        },
        combosUp: function (num) {
            $("#combo strong").text("X" + num);
        },
        showNextColor: function () {
            model.nextColor.forEach(function (item, index) {
                $("#next td").eq(index).removeClass().addClass(item);
            });
        }
    };
    var control = {
        init: function (elem) {
            model.$table = $(elem);
            model.$boxtemp = $(".boxtemp");
            model.$boxClone = model.$boxtemp.clone();
            var $tbody = elem.find("tbody"); //循环出表格
            for (var x = 1; x <= 7; x++) {
                var $tr = $("<tr></tr>");
                $tbody.append($tr);
                for (var y = 1; y <= 7; y++) {
                    var $td = $("<td class='clickBox'></td>")
                        .attr("data-pointX", x).attr("data-pointY", y).attr("data-color", "none");
                    $tr.append($td);
                }
            }
            model.boxWidth = elem.find("td").outerWidth(); //设置td的宽度
            elem.find("td").css("height", model.boxWidth + "px"); //设置td的高度
            model.$boxClone.css({height: model.boxWidth + 4 + "px", width: model.boxWidth + 4 + "px"});
            model.$table.parent().append(model.$boxClone);
            control.handleBox.nextColor()  //随机出point备用
            control.handleBox.setNextPoint();  //放置点
            control.action.prepare();

        },
        initStorage: function(elem,omodel){
            model.$table = $(elem);
            model.$boxtemp = $(".boxtemp");
            model.$boxClone = model.$boxtemp.clone();

            var $tbody = elem.find("tbody");
            for (var x = 1; x <= 7; x++) {
                var $tr = $("<tr></tr>");
                var $td;
                $tbody.append($tr);
                for (var y = 1; y <= 7; y++) {
                    if(omodel.matrix[x][y] != null){
                        var $td = $("<td class='clickBox'></td>")
                            .attr("data-pointX", omodel.matrix[x][y].x)
                            .attr("data-pointY", omodel.matrix[x][y].y)
                            .attr("data-color", omodel.matrix[x][y].color)
                            .addClass(omodel.matrix[x][y].color);
                    }else{
                        $td = $("<td class='clickBox'></td>")
                            .attr("data-pointX", x).attr("data-pointY", y).attr("data-color", "none");
                    }
                    $tr.append($td);
                }
            }
            model.boxWidth = elem.find("td").outerWidth(); //设置td的宽度
            elem.find("td").css("height", model.boxWidth + "px"); //设置td的高度
            model.$boxClone.css({height: model.boxWidth + 4 + "px", width: model.boxWidth + 4 + "px"});
            model.$table.parent().append(model.$boxClone);

            /*初始化*/
            model.matrix = new Matrix(omodel.matrix);
            model.score = omodel.score;
            model.combo = omodel.combo;
            model.progress = omodel.progress;
            model.level = omodel.level;
            model.nextNum = omodel.nextNum;
            model.size = omodel.size;
            model.nextColor = omodel.nextColor;
            /*初始化*/

            view.showNextColor(); // 显示下一个颜色
            view.levelUp(model.progress);
            view.progressUp(model.progress);
            view.scoreUp(model.score);
            view.combosUp(model.combo);
            control.action.prepare(); // 监听点击事件
        },
        action: {
            /*绑定事件*/
            prepare: function () {
                model.$table.on("click", ".clickBox", control.action.click);
            },
            click: function (even) {
                var $this = $(this);
                if (!model.doAnimate) {
                    var point = new model.Point(this);
                    if (model.matrix.getPoint(point)) {
                        control.handleBox.clickBox(point);
                    } else if (model.boxSelected) {
                        control.handleBox.moveBox(point);
                    }
                }
            }
        },
        handleBox: {
            /*生成点*/
            setNextPoint: function () {
                model.nextArr = util.randomPoint();
                model.doAnimate = true;
                control.handleBox.setPoint(0);
                //调用248行  go to 248
            },
            /*生成点*/
            setPoint: function (i) {
                if (i === model.nextArr.length) {
                    model.doAnimate = false;   //from 244
                    control.handleBox.nextColor();
                    util.serializeModel();
                } else {
                    view.boxGenerate(model.nextArr[i], function () {
                        model.matrix.setPoint(model.nextArr[i]);
                        control.handleBox.checkPoint(model.nextArr[i]);
                        if (model.matrix.getSize() === 49) {
                            alert("游戏结束!获得总分:" + model.score + "! 再接再厉!");
                            localStorage.removeItem("model");
                            localStorage.removeItem("modelKey");
                            location.reload();
                            return;
                        }
                        control.handleBox.setPoint(i + 1);
                    });
                }
            },
            /*检查点能到达的路径*/
            clickBox: function (point) {
                model.boxSelected = point;
                view.boxClick(point);
                var boxDaArr = control.algorithm.pointDisable(point);
                view.boxDisable(boxDaArr);
            },
            /*移动点到指定位置*/
            moveBox: function (point) {
                point.color = model.boxSelected.color;
                var boxPathArr = control.algorithm.pointMove(point, model.boxSelected); //获得移动的路径
                model.matrix.clearPoint(model.boxSelected); //setMatrix clearMatrix
                model.matrix.setPoint(point);
                /*移动点的位置*/
                view.boxMove(point, model.boxSelected, boxPathArr, function () {
                    if (!control.handleBox.checkPoint(point)) {   //不能清除时
                        control.handleBox.setNextPoint();
                    }else{
                        util.serializeModel();
                    }
                    model.boxSelected = null;
                });
            },
            /*检查点是否能消除*/
            checkPoint: function (point) {
                var SuccessArr = control.algorithm.pointCheck(point); //检查移动后是否能"消除point"
                if (SuccessArr) {
                    SuccessArr.forEach(function (item) {
                        model.matrix.clearPoint(item);
                        view.clearPoint(item);
                    });
                    control.handleBox.scoreUp(SuccessArr.length);
                    control.handleBox.comboUp();
                    return true;
                } else {
                    control.handleBox.comboClear();
                    return false;
                }
            },
            nextColor: function () {
                util.randomColor();
                view.showNextColor();
            },
            /*得分增加*/
            scoreUp: function (length) {
                var sum = 10;
                var score = Math.round(sum * Math.pow(model.multiple, length - 4 + model.combo));
                model.score += score;
                model.progress += score;
                if (model.score > model.Total[model.level]) {
                    if (model.level >= 3) {
                        alert("牛逼!");
                    }
                    model.progress = model.score - model.Total[model.level];
                    model.level++;
                    model.nextNum++;
                    control.handleBox.nextColor();
                    view.levelUp(model.progress);
                }
                view.progressUp(model.progress);
                view.scoreUp(model.score);
            },
            comboUp: function () {
                model.combo++;
                view.combosUp(model.combo);
            },
            comboClear: function () {
                model.combo = 0;
                view.combosUp(model.combo);
            }
        },
        algorithm: {
            pointCheck: function (point) {  //返回成功数组Point
                var SuccessArr = new Array();
                var x, y;
                var tempArr = new Array();
                for (var i = 1; i <= 7; i++) {   //列
                    if (model.matrix[i][point.y] && model.matrix[i][point.y].color === point.color)
                        tempArr.push(model.matrix[i][point.y]);
                    else if (tempArr.length >= 4)
                        break;
                    else
                        tempArr.splice(0, tempArr.length);
                }
                if (tempArr.length >= 4)
                    SuccessArr = SuccessArr.concat(tempArr);
                var tempArr = new Array();
                for (var i = 1; i <= 7; i++) {   //行
                    if (model.matrix[point.x][i] && model.matrix[point.x][i].color === point.color)
                        tempArr.push(model.matrix[point.x][i]);
                    else if (tempArr.length >= 4)
                        break;
                    else
                        tempArr.splice(0, tempArr.length);
                }
                if (tempArr.length >= 4)
                    SuccessArr = SuccessArr.concat(tempArr);
                var tempArr = new Array();
                var diff = Math.abs(point.x - point.y);
                if (point.x < point.y) {
                    x = 1;
                    y = 1 + diff;
                } else {
                    x = 1 + diff;
                    y = 1;
                }
                for (; x <= 7 && y <= 7; x++, y++) {   //斜
                    if (model.matrix[x][y] && model.matrix[x][y].color === point.color)
                        tempArr.push(model.matrix[x][y]);
                    else if (tempArr.length >= 4)
                        break;
                    else
                        tempArr.splice(0, tempArr.length);
                }
                if (tempArr.length >= 4)
                    SuccessArr = SuccessArr.concat(tempArr);
                var tempArr = new Array();
                var sub = point.x + point.y;
                if (sub > 8) {
                    x = sub - 7;
                    y = 7;
                } else {
                    x = 1;
                    y = sub - 1;
                }
                for (; x <= 7 && y >= 1; x++, y--) {   //斜
                    if (model.matrix[x][y] && model.matrix[x][y].color === point.color)
                        tempArr.push(model.matrix[x][y]);
                    else if (tempArr.length >= 4)
                        break;
                    else
                        tempArr.splice(0, tempArr.length);
                }
                if (tempArr.length >= 4)
                    SuccessArr = SuccessArr.concat(tempArr);
                if (SuccessArr.length)
                    return SuccessArr;
                else
                    return false;
            },
            pointDisable: function (point) {   //广度搜索找出所有能到达的点
                var matrixBool = model.matrix.genereatMaBool();
                var stack = new Array(point);
                while (stack.length) {
                    var p = stack.shift();
                    if (!matrixBool[p.x][p.y + 1]) {//向右走一步
                        var newP = new model.Point(p.x, p.y + 1);
                        stack.push(newP);
                        matrixBool[p.x][p.y + 1] = true;
                    }
                    if (!matrixBool[p.x + 1][p.y]) {//向下走一步
                        var newP = new model.Point(p.x + 1, p.y);
                        stack.push(newP);
                        matrixBool[p.x + 1][p.y] = true;
                    }
                    if (!matrixBool[p.x][p.y - 1]) {//向左走一步
                        var newP = new model.Point(p.x, p.y - 1);
                        stack.push(newP);
                        matrixBool[p.x][p.y - 1] = true;
                    }
                    if (!matrixBool[p.x - 1][p.y]) {//向上走一步
                        var newP = new model.Point(p.x - 1, p.y);
                        stack.push(newP);
                        matrixBool[p.x - 1][p.y] = true;
                    }
                }
                return util.genereatDaPoint(matrixBool);
            },
            pointMove: function (point, boxSelected) {
                var matrixBool = model.matrix.genereatMaBool();
                var stack = new Array(boxSelected);
                var stackPath = new Array(boxSelected);
                while (stack.length) {      //广度搜索出到达目标点的路径,,,
                    var p = stack.shift();
                    if (!matrixBool[p.x][p.y + 1]) {//向右走一步
                        var newP = new model.Point(p.x, p.y + 1);
                        if (newP.equal(point)) {
                            break;
                        }
                        stack.push(newP);
                        stackPath.push(newP);
                        matrixBool[p.x][p.y + 1] = true;
                    }
                    if (!matrixBool[p.x + 1][p.y]) {//向下走一步
                        var newP = new model.Point(p.x + 1, p.y);
                        if (newP.equal(point)) {
                            break;
                        }
                        stack.push(newP);
                        stackPath.push(newP);
                        matrixBool[p.x + 1][p.y] = true;
                    }
                    if (!matrixBool[p.x][p.y - 1]) {//向左走一步
                        var newP = new model.Point(p.x, p.y - 1);
                        if (newP.equal(point)) {
                            break;
                        }
                        stack.push(newP);
                        stackPath.push(newP);
                        matrixBool[p.x][p.y - 1] = true;
                    }
                    if (!matrixBool[p.x - 1][p.y]) {//向上走一步
                        var newP = new model.Point(p.x - 1, p.y);
                        if (newP.equal(point)) {
                            break;
                        }
                        stack.push(newP);
                        stackPath.push(newP);
                        matrixBool[p.x - 1][p.y] = true;
                    }
                }

                var oldP = point;
                var arrPath = new Array(point);
                while (stackPath.length) {   //筛选路径,,找到最短一条
                    var p = stackPath.pop();
                    if (oldP.isNearPoint(p)) {
                        arrPath.unshift(p);
                        oldP = p;
                    }
                }
                return arrPath;
            }
        }
    };
    var util = {
        key: "KZxdfNuj349r34jUHW94r33ke32orkr323D88iVTg6GD4ZhS7Q",
        checkNextArr: function (point, nextArr) {
            return nextArr.some(function (item) {
                return point.equal(item);
            });
        },
        randomColor: function () {
            model.nextColor.splice(0, model.nextColor.length);
            for (var i = 0; i < model.nextNum; i++) {
                var colorNum = parseInt(Math.random() * (0 - 5 + 1) + 5);
                var colorArr = util.getObjvalues(model.color);
                model.nextColor.push(colorArr[colorNum]);
            }
        },
        randomPoint: function () {
            var nextArr = new Array();
            for (var i = 0; i < model.nextNum; i++) {
                var x = parseInt(Math.random() * (0 - 8 + 1) + 8);
                var y = parseInt(Math.random() * (0 - 8 + 1) + 8);
                var pTemp = new model.Point(x, y);
                while (model.matrix[x][y] || util.checkNextArr(pTemp, nextArr)) {
                    x = parseInt(Math.random() * (0 - 8 + 1) + 8);
                    y = parseInt(Math.random() * (0 - 8 + 1) + 8);
                    pTemp = new model.Point(x, y);
                }
                var point = new model.Point(x, y, model.nextColor[i]);
                nextArr.push(point);
                if (model.matrix.getSize() + nextArr.length === 49)
                    break;
            }
            return nextArr;
        },
        getObjvalues: function (obj) {
            return vals = Object.keys(obj).map(function (key) {
                return obj[key];
            });
        },
        genereatDaPoint: function (matrixBool) {
            var arr = new Array();
            for (var i = 0; i < matrixBool.length; i++) {
                for (var j = 0; j < matrixBool[i].length; j++) {
                    if (!matrixBool[i][j])
                        arr.push(new model.Point(i, j));
                }
            }
            return arr;
        },
        serializeModel: function () {
            var modelStr = JSON.stringify(model)
            localStorage.setItem("model", modelStr);
            localStorage.setItem("modelKey", util.checkmmmm(modelStr));
        },
        unSerializeModel: function () {
            var modelStr = localStorage.getItem("model");
            var modelKey = localStorage.getItem("modelKey")
            if(modelStr == null || modelKey == null){
                return null;
            }
            var modelKeyN = util.checkmmmm(modelStr)
            if(modelKeyN !== modelKey){
                alert("请不要篡改游戏数据!")
                localStorage.removeItem("model")
                localStorage.removeItem("modelKey")
                location.reload();
            }else{
                return JSON.parse(modelStr)
            }
        },
        checkmmmm:function (modelStr) {
            var key = hex_md5(util.key)
            var md5 = b64_hmac_md5(modelStr, key);
            return hex_md5(md5);
        }
    };
    $.fn.game = function () {
//        options = $.extend({}, $.fn.notebook.defaults, options);
        var omodel = util.unSerializeModel()
        if(omodel != null){
            control.initStorage(this,omodel);
        }else{
            control.init(this);
        }
        return this;
    };
})(jQuery, document, window);

