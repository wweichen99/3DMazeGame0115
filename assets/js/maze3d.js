(function() {
    var renderer, camera, scene;
    var input, levelHelper, cameraHelper;
    var map = [];
    var running = false;
    var isWarmUp = true; 

    var experimentMode = null; 
    var _plActive = false;
    var _mouseSensitivity = 0.002;
    var _keys = { w: false, a: false, s: false, d: false };
    var _skipFirstMouseMove = false;

    // === 火灾与烟雾系统 ===
    var fireSystem, smokeSystem;
    var fireParticles = 1500;
    var smokeParticles = 2000;
    var fireSourcePosition = new THREE.Vector3(); 
    var fireRadius = 0;                           
    var fireSpreadRate = 0.15;                    
    var fireGraceRadius = 100;
    var experimentStartTime = 0;
    var exitPosition = new THREE.Vector3(); 
    var warmUpTimer = 0;

    // === 数据记录与地图缩放 ===
    var viewportLogs = [], minimapLogs = { hovers: {} }, gazeLogs = []; 
    var lastLogTime = 0, LOG_INTERVAL = 250; 
    var gazeBuffer = [], GAZE_BUFFER_SIZE = 8;
    
    // 自适应小地图缩放倍率
    var mapScale = 16; 

    function $(id){ return document.getElementById(id); }
    function isWallCellByValue(v){ return (v != 1 && !isNaN(v)); }

    /**
     * 自适应功能：根据容器大小动态计算小地图缩放比例
     */
    function calculateMapScale() {
        var container = $("minimap-container");
        if (!container || map.length === 0) return 16;
        var rect = container.getBoundingClientRect();
        // 留出5%的边距
        var availableSize = Math.min(rect.width, rect.height) * 0.95;
        var mazeMaxDim = Math.max(map.length, map[0].length);
        return availableSize / mazeMaxDim;
    }

    // === 辅助函数：创建粒子纹理 ===
    function createParticleTexture() {
        var canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        var ctx = canvas.getContext('2d');
        var grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
        var tex = new THREE.Texture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    // === 辅助函数：创建文字精灵 ===
    function createTextSprite(message) {
        var canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 256;
        var ctx = canvas.getContext('2d');
        ctx.font = "Bold 100px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.strokeStyle = "rgba(0,0,0,1.0)"; ctx.lineWidth = 8;
        ctx.strokeText(message, 256, 128);
        ctx.fillStyle = "#ffffff"; ctx.fillText(message, 256, 128);
        var texture = new THREE.Texture(canvas); texture.needsUpdate = true;
        var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
        sprite.scale.set(80, 40, 1); 
        return sprite;
    }

    // === 游戏入口 ===
    window.startGame = function(mode) {
        experimentMode = mode;
        $('setup-screen').style.display = 'none';
        startCalibrationPhase();
    };

    // === 校准逻辑 ===
    var calibPoints = [[10,10], [50,10], [90,10], [10,50], [50,50], [90,50], [10,90], [50,90], [90,90]];
    var currentPointIdx = 0, clicksPerPoint = 5, currentClicks = 0;

    function startCalibrationPhase() {
        $('calibration-overlay').style.display = 'block';
        initWebGazer(); 
        showNextCalibrationPoint();
    }

    function showNextCalibrationPoint() {
        if (currentPointIdx >= calibPoints.length) { finishCalibration(); return; }
        var overlay = $('calibration-overlay');
        var oldDot = $('calib-dot'); if (oldDot) oldDot.remove();
        var dot = document.createElement('div');
        dot.id = 'calib-dot';
        dot.style.cssText = `position: absolute; width: 25px; height: 25px; background: #e74c3c; border: 3px solid #fff; border-radius: 50%; cursor: pointer; left: ${calibPoints[currentPointIdx][0]}%; top: ${calibPoints[currentPointIdx][1]}%; transform: translate(-50%, -50%); z-index: 10000;`;
        dot.onclick = function() {
            currentClicks++;
            if (currentClicks >= clicksPerPoint) {
                currentPointIdx++; currentClicks = 0;
                $('calib-status').innerText = `Progress: ${currentPointIdx}/9 dots`;
                showNextCalibrationPoint();
            }
        };
        overlay.appendChild(dot);
    }

    function finishCalibration() {
        $('calibration-overlay').style.display = 'none';
        $('ui-layer').style.opacity = '1';
        initializeEngine();
        configureUIForMode(experimentMode);
        levelHelper = new Demonixis.GameHelper.LevelHelper();
        loadLevel(5); // 加载练习关卡
    }

    function initWebGazer() {
        if (typeof webgazer !== 'undefined') {
            webgazer.setGazeListener(function(data) {
                if (data && running) {
                    gazeBuffer.push({ x: data.x, y: data.y });
                    if (gazeBuffer.length > GAZE_BUFFER_SIZE) gazeBuffer.shift();
                    var avgX = gazeBuffer.reduce((s, p) => s + p.x, 0) / gazeBuffer.length;
                    var avgY = gazeBuffer.reduce((s, p) => s + p.y, 0) / gazeBuffer.length;
                    gazeLogs.push({ t: Date.now(), x: Math.round(avgX), y: Math.round(avgY) });
                }
            }).begin();
            webgazer.showVideoPreview(true).showPredictionPoints(true);
            
            // 将 WebGazer 视频流移动到 HUD 容器
            var moveUI = setInterval(function(){
                var v = $('webgazerVideoFeed'), t = $('webgazer-target');
                if (v && t && v.parentElement !== t) {
                    t.innerHTML = '';
                    [v, $('webgazerVideoCanvas'), $('webgazerFaceOverlay'), $('webgazerFaceFeedbackBox')].forEach(el => {
                        if(el) { t.appendChild(el); el.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; transform:scaleX(-1);"; }
                    });
                    clearInterval(moveUI);
                }
            }, 500);
        }
    }

    // === 引擎初始化 (核心修改：自适应窗口) ===
    function initializeEngine() {
        if (renderer) return; 
        renderer = new THREE.WebGLRenderer({ antialias: true });
        
        // 关键：适配高 DPI 屏幕 (Retina / 4K)
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        
        scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x1a1a1a, 0.0005);
        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
        
        $("canvasContainer").appendChild(renderer.domElement);
        input = new Demonixis.Input();
        cameraHelper = new Demonixis.GameHelper.CameraHelper(camera);
        cameraHelper.translation = 5; 
        cameraHelper.rotation = 0.04;

        setupPointerLock();
        setupMinimapTracking();

        // 关键：监听窗口缩放
        window.addEventListener("resize", function() {
            var w = window.innerWidth;
            var h = window.innerHeight;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            drawMiniMapStatic(); // 窗口变化时重新计算小地图缩放
        });

        window.addEventListener("keydown", (e) => { if(_keys.hasOwnProperty(e.key.toLowerCase())) _keys[e.key.toLowerCase()] = true; });
        window.addEventListener("keyup", (e) => { if(_keys.hasOwnProperty(e.key.toLowerCase())) _keys[e.key.toLowerCase()] = false; });
    }

    // === 火灾模拟逻辑 ===
    function initFireEffects() {
        if (isWarmUp) return; 
        fireRadius = 0; 
        var tex = createParticleTexture();
        var fireGeo = new THREE.Geometry();
        for (var i = 0; i < fireParticles; i++) { fireGeo.vertices.push(fireSourcePosition.clone()); }
        fireSystem = new THREE.Points(fireGeo, new THREE.PointsMaterial({ map: tex, color: 0xff4400, size: 25, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
        scene.add(fireSystem);

        var smokeGeo = new THREE.Geometry();
        for (var i = 0; i < smokeParticles; i++) { smokeGeo.vertices.push(new THREE.Vector3((Math.random()-0.5)*3500, Math.random()*200, (Math.random()-0.5)*3500)); }
        smokeSystem = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ map: tex, color: (experimentMode === 'xray') ? 0x444444 : 0x222222, size: (experimentMode === 'xray') ? 40 : 80, transparent: true, opacity: 0.2, depthWrite: false }));
        scene.add(smokeSystem);
    }

    function updateEffects() {
        if (!fireSystem || isWarmUp || !running) return;
        fireRadius += fireSpreadRate;
        fireSystem.geometry.vertices.forEach(v => {
            v.y += 1.5 + Math.random();
            var dx = v.x - fireSourcePosition.x, dz = v.z - fireSourcePosition.z;
            if (v.y > 90 || Math.sqrt(dx*dx + dz*dz) > fireRadius) {
                v.y = Math.random() * 10;
                var angle = Math.random() * Math.PI * 2;
                var rd = Math.random() * fireRadius;
                v.x = fireSourcePosition.x + Math.cos(angle) * rd;
                v.z = fireSourcePosition.z + Math.sin(angle) * rd;
            }
        });
        fireSystem.geometry.verticesNeedUpdate = true;
        smokeSystem.geometry.vertices.forEach(v => { v.y += 0.3; if (v.y > 180) v.y = 0; v.x += Math.sin(Date.now()*0.0005)*0.2; });
        smokeSystem.geometry.verticesNeedUpdate = true;
        
        var maxFog = (experimentMode === 'xray') ? 0.004 : 0.015;
        if (scene.fog.density < maxFog) scene.fog.density += (experimentMode === 'xray' ? 0.000002 : 0.000008);

        if (fireRadius > fireGraceRadius && camera.position.distanceTo(fireSourcePosition) < fireRadius) {
            running = false; alert("你被大火吞噬了！逃生失败。"); location.reload(); 
        }
    }

    // === 移动控制与碰撞检测 ===
    function moveCamera(dir) {
        if (!running) return;
        var dx = 0, dz = 0, rot = camera.rotation.y;
        if (dir === "left") { camera.rotation.y += cameraHelper.rotation; return; }
        if (dir === "right") { camera.rotation.y -= cameraHelper.rotation; return; }
        if (dir === "up") { dx = -Math.sin(rot) * cameraHelper.translation; dz = -Math.cos(rot) * cameraHelper.translation; }
        else if (dir === "down") { dx = Math.sin(rot) * cameraHelper.translation; dz = Math.cos(rot) * cameraHelper.translation; }
        
        var r = 15;
        var isWall = function(x, z) {
            var tx = Math.floor((x - cameraHelper.origin.x + 50) / 100);
            var ty = Math.floor((z - cameraHelper.origin.z + 50) / 100);
            if (ty < 0 || ty >= map.length || tx < 0 || tx >= map[0].length) return true;
            if (map[ty][tx] === "A" && running) { nextLevel(); return false; } 
            return (map[ty][tx] != 1 && !isNaN(map[ty][tx])); 
        };
        if (!(isWall(camera.position.x+dx+r, camera.position.z+dz+r) || isWall(camera.position.x+dx-r, camera.position.z+dz+r))) {
            camera.position.x += dx; camera.position.z += dz;
        }
    }

    function nextLevel() {
        if (!running) return;
        running = false;
        for (var k in _keys) _keys[k] = false;
        if (isWarmUp) {
            isWarmUp = false; alert("正式开始：请迅速逃向出口（绿色光柱）！"); loadLevel(1); 
        } else {
            alert("成功逃生！请点击下载实验日志。");
        }
    }

    function update() {
        if (!running) return;
        if (input.keys.up || _keys.w) moveCamera("up");
        if (input.keys.down || _keys.s) moveCamera("down");
        if (input.keys.left || _keys.a) moveCamera("left");
        if (input.keys.right || _keys.d) moveCamera("right");
        updateMiniMapOverlay();
        updateEffects();
        if (isWarmUp && ++warmUpTimer > 1800) nextLevel();
        
        var now = Date.now();
        if (now - lastLogTime > LOG_INTERVAL) {
            viewportLogs.push({ t: now, x: camera.position.x.toFixed(1), z: camera.position.z.toFixed(1), rot: camera.rotation.y.toFixed(3) });
            lastLogTime = now;
        }
    }

    // === 场景加载 ===
    function initializeScene() {
        while(scene.children.length > 0){ scene.remove(scene.children[0]); }
        var loader = new THREE.TextureLoader();
        var pW = map[0].length * 100, pH = map.length * 100;
        cameraHelper.origin.x = -pW / 2; cameraHelper.origin.z = -pH / 2;

        scene.add(new THREE.Mesh(new THREE.BoxGeometry(pW, 5, pH), new THREE.MeshPhongMaterial({ map: loader.load("assets/images/textures/ground_diffuse.jpg") })).translateY(1));
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(pW, 5, pH), new THREE.MeshPhongMaterial({ map: loader.load("assets/images/textures/roof_diffuse.jpg") })).translateY(100));
        
        var wallGeo = new THREE.BoxGeometry(100, 100, 100), wallMat = new THREE.MeshPhongMaterial({ map: loader.load("assets/images/textures/wall_diffuse.jpg") });
        var xrayMat = new THREE.MeshBasicMaterial({ color: 0x0066ff, transparent: true, opacity: 0.15, depthWrite: false });

        for (var y = 0; y < map.length; y++) {
            for (var x = 0; x < map[y].length; x++) {
                var px = -pW / 2 + 100 * x, pz = -pH / 2 + 100 * y;
                if (map[y][x] > 1) {
                    var m = new THREE.Mesh(wallGeo, experimentMode === 'minimap' ? wallMat : xrayMat);
                    m.position.set(px, 50, pz); scene.add(m);
                    if (experimentMode === 'xray') {
                        var wire = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeo), new THREE.LineBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.5 }));
                        wire.position.set(px, 50, pz); scene.add(wire);
                    }
                }
                if (map[y][x] === "D") { camera.position.set(px, 50, pz); fireSourcePosition.set(px, 50, pz); }
                if (map[y][x] === "A") {
                    var exit = new THREE.Mesh(new THREE.BoxGeometry(20, 100, 20), new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.6 }));
                    exit.position.set(px, 50, pz); scene.add(exit);
                    if (experimentMode === 'xray') { var lbl = createTextSprite("EXIT"); lbl.position.set(px, 70, pz); lbl.material.depthTest = false; scene.add(lbl); }
                }
            }
        }
        scene.add(new THREE.HemisphereLight(0x888888, 0x111111, 1.2));
        drawMiniMapStatic();
        fireRadius = 0; initFireEffects(); 
    }

    function mainLoop() { if (running) { update(); renderer.render(scene, camera); requestAnimationFrame(mainLoop); } }
    
    function loadLevel(l) {
        var ajax = new XMLHttpRequest(); ajax.open("GET", "assets/maps/maze3d-" + l + ".json", true);
        ajax.onreadystatechange = function() { 
            if (ajax.readyState == 4) { map = JSON.parse(ajax.responseText); initializeScene(); running = true; mainLoop(); } 
        };
        ajax.send(null);
    }

    function setupPointerLock() {
        var el = renderer.domElement; 
        el.onclick = () => { if(running) el.requestPointerLock(); };
        document.addEventListener('pointerlockchange', () => { _plActive = (document.pointerLockElement === el); if (_plActive) _skipFirstMouseMove = true; });
        document.addEventListener('mousemove', (e) => { 
            if (_plActive && running) { 
                if (_skipFirstMouseMove) { _skipFirstMouseMove = false; return; } 
                camera.rotation.y -= e.movementX * _mouseSensitivity; 
            } 
        });
    }

    // === 小地图绘制 (核心修改：动态 Scale) ===
    function drawMiniMapStatic() {
        var mm = $("minimap"), o = $("objects"); if (!mm || !o || map.length === 0) return;
        
        mapScale = calculateMapScale(); // 动态计算
        mm.width = o.width = map[0].length * mapScale; 
        mm.height = o.height = map.length * mapScale;
        
        var ctx = mm.getContext("2d");
        for (var y=0; y<map.length; y++) {
            for (var x=0; x<map[0].length; x++) {
                ctx.fillStyle = (map[y][x] === 'A') ? "#2ecc71" : (isWallCellByValue(map[y][x]) ? "#333" : "#eee");
                ctx.fillRect(x*mapScale, y*mapScale, mapScale, mapScale);
                if (map[y][x] === 'A') { ctx.fillStyle = "white"; ctx.font = `bold ${Math.floor(mapScale*0.8)}px Arial`; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("E", x*mapScale+mapScale/2, y*mapScale+mapScale/2); }
            }
        }
    }

    function updateMiniMapOverlay() {
        var o = $("objects"); if (!o || experimentMode === 'xray' || map.length === 0) return;
        var ctx = o.getContext("2d"); ctx.clearRect(0, 0, o.width, o.height);
        var fs = worldToTileFloat(fireSourcePosition.x, fireSourcePosition.z);
        ctx.strokeStyle = "rgba(255, 0, 0, 0.4)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(fs.tx * mapScale, fs.ty * mapScale, (fireRadius / 100) * mapScale, 0, Math.PI*2); ctx.stroke();
        var p = worldToTileFloat(camera.position.x, camera.position.z), tx = p.tx * mapScale, ty = p.ty * mapScale;
        ctx.fillStyle = "#00f0ff"; ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = "#00f0ff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.sin(camera.rotation.y)*20, ty - Math.cos(camera.rotation.y)*20); ctx.stroke();
    }

    function worldToTileFloat(wx, wz) {
        var pW = map[0].length * 100, pH = map.length * 100;
        return { tx: (wx + pW/2) / 100 + 0.2, ty: (wz + pH/2) / 100 + 0.4 };
    }

    window.downloadMazeData = function() {
        var a = document.createElement('a'); 
        a.href = URL.createObjectURL(new Blob([JSON.stringify({ mode: experimentMode, viewport: viewportLogs, eye: gazeLogs }, null, 2)], {type : 'application/json'}));
        a.download = `maze_study_${Date.now()}.json`; a.click();
    };

    function configureUIForMode(m) { 
        $("hud-right").style.display = (m === 'minimap') ? 'flex' : 'none'; 
        if($("btn-toggle-map")) $("btn-toggle-map").style.display = (m === 'minimap') ? 'flex' : 'none'; 
    }

    function setupMinimapTracking() {
        var o = $("objects"); if (!o) return;
        o.addEventListener('mousemove', (e) => {
            var r = o.getBoundingClientRect(), gx = Math.floor(((e.clientX - r.left) * (o.width / r.width)) / mapScale), gy = Math.floor(((e.clientY - r.top) * (o.height / r.height)) / mapScale);
            if (gx >= 0 && gy >= 0 && gy < map.length && gx < map[0].length) minimapLogs.hovers[`${gx},${gy}`] = (minimapLogs.hovers[`${gx},${gy}`] || 0) + 1;
        });
    }
})();