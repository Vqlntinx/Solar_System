// =======================
//  Vertex / Fragment Shader
// =======================

const vsSource = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aTexCoord;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;

varying vec3 vFragPos;
varying vec3 vNormal;
varying vec2 vTexCoord;

void main() {
    vec4 worldPos = uModel * vec4(aPosition, 1.0);
    vFragPos = worldPos.xyz;
    vNormal = normalize(uNormalMatrix * aNormal);
    vTexCoord = aTexCoord;
    gl_Position = uProjection * uView * worldPos;
}
`;

const fsSource = `
precision mediump float;

varying vec3 vFragPos;
varying vec3 vNormal;
varying vec2 vTexCoord;

uniform vec3 uViewPos;

// 🔆 태양 위치 (점광원)
uniform vec3 uLightPos;
uniform vec3 uLightColor;

uniform vec3 uObjectColor;
uniform bool uUseTexture;
uniform sampler2D uSampler;
uniform bool uIsEmissive;  // 태양처럼 자체 발광하는지 여부

// Phong shading + texture (point light)
void main() {
    vec4 baseColor;
    if (uUseTexture) {
        baseColor = texture2D(uSampler, vTexCoord);
    } else {
        baseColor = vec4(uObjectColor, 1.0);
    }

    // 태양처럼 자체 발광하는 경우 조명 계산 건너뛰기
    if (uIsEmissive) {
        // 텍스처가 없거나 어두우면 objectColor 사용, 있으면 밝게
        vec3 finalColor;
        if (uUseTexture) {
            // 텍스처 색상이 너무 어두우면 objectColor와 혼합
            float brightness = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
            if (brightness < 0.3) {
                finalColor = mix(baseColor.rgb, uObjectColor, 0.7);
            } else {
                finalColor = baseColor.rgb;
            }
            finalColor = finalColor * 2.0; // 밝기 증가
        } else {
            finalColor = uObjectColor * 2.0; // 텍스처 없을 때 objectColor 사용
        }
        gl_FragColor = vec4(finalColor, 1.0);
        return;
    }

    vec3 norm = normalize(vNormal);

    // 점광원 방향
    vec3 lightDir = normalize(uLightPos - vFragPos);

    // ambient
    float ambientStrength = 0.18;
    vec3 ambient = ambientStrength * uLightColor;

    // diffuse
    float diff = max(dot(norm, lightDir), 0.0);
    vec3 diffuse = diff * uLightColor;

    // specular
    vec3 viewDir = normalize(uViewPos - vFragPos);
    vec3 reflectDir = reflect(-lightDir, norm);
    float spec = pow(max(dot(viewDir, reflectDir), 0.0), 64.0);
    float specStrength = 0.6;
    vec3 specular = specStrength * spec * uLightColor;

    vec3 lighting = ambient + diffuse + specular;

    gl_FragColor = vec4(lighting, 1.0) * baseColor;
}
`;

// =======================
//  초기화
// =======================

function initWebGL() {
    const canvas = document.getElementById("glcanvas");
    const gl = canvas.getContext("webgl");
    if (!gl) {
        alert("WebGL not supported");
        return;
    }
    resizeCanvasToDisplaySize(gl.canvas);

    const shaderProgram = initShaderProgram(gl, vsSource, fsSource);
    const programInfo = {
        program: shaderProgram,
        attribLocations: {
            position: gl.getAttribLocation(shaderProgram, 'aPosition'),
            normal:   gl.getAttribLocation(shaderProgram, 'aNormal'),
            texCoord: gl.getAttribLocation(shaderProgram, 'aTexCoord'),
        },
        uniformLocations: {
            model:        gl.getUniformLocation(shaderProgram, 'uModel'),
            view:         gl.getUniformLocation(shaderProgram, 'uView'),
            projection:   gl.getUniformLocation(shaderProgram, 'uProjection'),
            normalMatrix: gl.getUniformLocation(shaderProgram, 'uNormalMatrix'),
            viewPos:      gl.getUniformLocation(shaderProgram, 'uViewPos'),
            lightPos:     gl.getUniformLocation(shaderProgram, 'uLightPos'),
            lightColor:   gl.getUniformLocation(shaderProgram, 'uLightColor'),
            objectColor:  gl.getUniformLocation(shaderProgram, 'uObjectColor'),
            useTexture:   gl.getUniformLocation(shaderProgram, 'uUseTexture'),
            sampler:      gl.getUniformLocation(shaderProgram, 'uSampler'),
            isEmissive:   gl.getUniformLocation(shaderProgram, 'uIsEmissive'),
        }
    };

    // 구 지오메트리 (태양, 지구, 달 모두 사용)
    const sphere = initSphereBuffers(gl, 32, 32); // latBands, lonBands

    // 텍스처 로딩
    const earthTex = loadTexture(gl, 'textures/earth.jpg');
    const sunTex   = loadTexture(gl, 'textures/sun.jpg');   // 없으면 기본 회색
    const moonTex  = loadTexture(gl, 'textures/moon.jpg');  // 없으면 기본 회색

    // 카메라 (orbit)
    let camRadius = 25.0;
    let camYaw   = Math.PI / 4;
    let camPitch = 0.25;

    initMouseControls(canvas, (dx, dy) => {
        camYaw   += dx * 0.01;
        camPitch += dy * 0.01;
        const limit = Math.PI / 2 - 0.1;
        camPitch = Math.max(-limit, Math.min(limit, camPitch));
    }, (delta) => {
        camRadius += delta * 0.02;
        camRadius = Math.max(8.0, Math.min(60.0, camRadius));
    });

    gl.enable(gl.DEPTH_TEST);

    let focusTarget = 'sun';
    initFocusControls((target) => {
        focusTarget = target;
    });

    let lastTime = 0;

    function render(now) {
        now *= 0.001;
        const dt = now - lastTime;
        lastTime = now;

        resizeCanvasToDisplaySize(gl.canvas);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        // 우주 느낌 배경 색
        gl.clearColor(0.01, 0.01, 0.04, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(programInfo.program);

        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        const projection = mat4.create();
        mat4.perspective(projection, 45 * Math.PI / 180, aspect, 0.1, 200.0);

        // 궤도 및 위치 계산
        const earthOrbitRadius = 12.0;
        const earthOrbitSpeed  = 0.4;
        const earthAngle = now * earthOrbitSpeed;
        const earthPos = [
            Math.cos(earthAngle) * earthOrbitRadius,
            0,
            Math.sin(earthAngle) * earthOrbitRadius
        ];

        const moonOrbitRadius = 3.5;
        const moonOrbitSpeed  = 1.2;
        const moonAngle = now * moonOrbitSpeed;
        const moonPos = [
            earthPos[0] + Math.cos(moonAngle) * moonOrbitRadius,
            earthPos[1] + Math.sin(moonAngle * 0.3) * 0.6,
            earthPos[2] + Math.sin(moonAngle) * moonOrbitRadius
        ];

        const focusPosition = getFocusPosition(focusTarget, earthPos, moonPos);
        const orbitOffset = [
            camRadius * Math.cos(camPitch) * Math.sin(camYaw),
            camRadius * Math.sin(camPitch),
            camRadius * Math.cos(camPitch) * Math.cos(camYaw)
        ];
        const eye = [
            focusPosition[0] + orbitOffset[0],
            focusPosition[1] + orbitOffset[1],
            focusPosition[2] + orbitOffset[2]
        ];
        const center = focusPosition;
        const up = [0, 1, 0];

        const view = mat4.create();
        mat4.lookAt(view, eye, center, up);

        gl.uniformMatrix4fv(programInfo.uniformLocations.view, false, view);
        gl.uniformMatrix4fv(programInfo.uniformLocations.projection, false, projection);
        gl.uniform3fv(programInfo.uniformLocations.viewPos, eye);

        // 태양 위치 & 색 (광원)
        const lightPos = [0, 0, 0];
        gl.uniform3fv(programInfo.uniformLocations.lightPos, lightPos);
        gl.uniform3fv(programInfo.uniformLocations.lightColor, [1.0, 0.95, 0.85]);

        // ===== 1) 태양 =====
        {
            const model = mat4.create();
            // 태양을 살짝 자전시켜도 됨
            mat4.rotateY(model, model, now * 0.2);
            mat4.scale(model, model, [4.0, 4.0, 4.0]); // 가장 크게

            drawObject(gl, programInfo, sphere, {
                model,
                useTexture: true,        // 텍스처 사용 (sunTex 없으면 기본색)
                texture: sunTex,
                objectColor: [1.0, 0.9, 0.6], // 텍스처 없을 때 밝은 노란색
                isEmissive: true         // 태양은 자체 발광
            });
        }

        // ===== 2) 지구 (태양 주위를 공전) =====
        {
            const model = mat4.create();
            mat4.translate(model, model, earthPos);
            // 자전
            mat4.rotateY(model, model, now * 1.0);
            mat4.scale(model, model, [1.6, 1.6, 1.6]);

            drawObject(gl, programInfo, sphere, {
                model,
                useTexture: true,          // 지구는 텍스처 필수
                texture: earthTex,
                objectColor: [0.2, 0.4, 1.0],
                isEmissive: false
            });
        }

        // ===== 3) 달 (지구 주위를 공전) =====
        {
            const model = mat4.create();
            mat4.translate(model, model, moonPos);
            mat4.rotateY(model, model, now * 0.8);
            mat4.scale(model, model, [0.6, 0.6, 0.6]);

            drawObject(gl, programInfo, sphere, {
                model,
                useTexture: true,          // 달도 텍스처 있으면 좋고, 없으면 objectColor
                texture: moonTex,
                objectColor: [0.8, 0.8, 0.8],
                isEmissive: false
            });
        }

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

// =======================
//  Sphere Geometry
// =======================

function initSphereBuffers(gl, latBands, lonBands) {
    const positions = [];
    const normals   = [];
    const texCoords = [];

    for (let lat = 0; lat < latBands; lat++) {
        const theta1 = (lat    / latBands) * Math.PI;
        const theta2 = ((lat+1)/ latBands) * Math.PI;

        const sin1 = Math.sin(theta1);
        const cos1 = Math.cos(theta1);
        const sin2 = Math.sin(theta2);
        const cos2 = Math.cos(theta2);

        for (let lon = 0; lon < lonBands; lon++) {
            const phi1 = (lon    / lonBands) * 2.0 * Math.PI;
            const phi2 = ((lon+1)/ lonBands) * 2.0 * Math.PI;

            const sinPhi1 = Math.sin(phi1);
            const cosPhi1 = Math.cos(phi1);
            const sinPhi2 = Math.sin(phi2);
            const cosPhi2 = Math.cos(phi2);

            // 네 점 (위쪽/아래쪽, 왼/오른)
            const p1 = [sin1 * cosPhi1, cos1, sin1 * sinPhi1];
            const p2 = [sin2 * cosPhi1, cos2, sin2 * sinPhi1];
            const p3 = [sin2 * cosPhi2, cos2, sin2 * sinPhi2];
            const p4 = [sin1 * cosPhi2, cos1, sin1 * sinPhi2];

            const uv1 = [lon    / lonBands, lat    / latBands];
            const uv2 = [lon    / lonBands, (lat+1)/ latBands];
            const uv3 = [(lon+1)/ lonBands, (lat+1)/ latBands];
            const uv4 = [(lon+1)/ lonBands, lat    / latBands];

            // 삼각형 두 개 (p1,p2,p3) (p1,p3,p4)
            positions.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
            normals.push  (...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
            texCoords.push(...uv1, ...uv2, ...uv3, ...uv1, ...uv3, ...uv4);
        }
    }

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

    return {
        position: positionBuffer,
        normal:   normalBuffer,
        texCoord: texCoordBuffer,
        vertexCount: positions.length / 3
    };
}

// =======================
//  그리기 공통 함수
// =======================

function drawObject(gl, programInfo, geometry, options) {
    const { model, useTexture, texture, objectColor, isEmissive } = options;

    gl.uniformMatrix4fv(programInfo.uniformLocations.model, false, model);

    const normalMatrix = mat3.create();
    const model3 = mat3.create();
    mat3.fromMat4(model3, model);
    mat3.invert(normalMatrix, model3);
    mat3.transpose(normalMatrix, normalMatrix);
    gl.uniformMatrix3fv(programInfo.uniformLocations.normalMatrix, false, normalMatrix);

    gl.uniform3fv(programInfo.uniformLocations.objectColor, objectColor);
    gl.uniform1i(programInfo.uniformLocations.useTexture, useTexture ? 1 : 0);
    gl.uniform1i(programInfo.uniformLocations.isEmissive, isEmissive ? 1 : 0);

    if (useTexture && texture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(programInfo.uniformLocations.sampler, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.position);
    gl.vertexAttribPointer(programInfo.attribLocations.position, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.position);

    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normal);
    gl.vertexAttribPointer(programInfo.attribLocations.normal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.normal);

    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.texCoord);
    gl.vertexAttribPointer(programInfo.attribLocations.texCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.texCoord);

    gl.drawArrays(gl.TRIANGLES, 0, geometry.vertexCount);
}

// =======================
//  Texture 로딩
// =======================

function loadTexture(gl, url) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // 임시 1x1 픽셀 (로딩 전) - 밝은 색상으로 설정
    const level = 0;
    const internalFormat = gl.RGBA;
    const width = 1;
    const height = 1;
    const border = 0;
    const srcFormat = gl.RGBA;
    const srcType = gl.UNSIGNED_BYTE;
    const pixel = new Uint8Array([255, 255, 255, 255]); // 밝은 흰색으로 초기화
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
        width, height, border, srcFormat, srcType, pixel);

    // 텍스처 파라미터 설정 (중요!)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const image = new Image();
    image.onload = function () {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
            srcFormat, srcType, image);
        gl.generateMipmap(gl.TEXTURE_2D);
    };
    image.onerror = function () {
        console.warn('텍스처 로딩 실패:', url);
    };
    image.src = url;

    return texture;
}

// =======================
//  Shader 유틸
// =======================

function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader   = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program:', gl.getProgramInfoLog(shaderProgram));
        return null;
    }
    return shaderProgram;
}

function loadShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// =======================
//  Canvas 리사이즈
// =======================

function resizeCanvasToDisplaySize(canvas) {
    const width  = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width  = width;
        canvas.height = height;
    }
}

// =======================
//  마우스 인터랙션
// =======================

function initMouseControls(canvas, onDrag, onWheel) {
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        onDrag(dx, dy);
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        onWheel(e.deltaY);
    }, { passive: false });
}

// =======================
//  시점 전환 컨트롤
// =======================

function initFocusControls(onChange) {
    const buttons = document.querySelectorAll('[data-focus-target]');
    if (!buttons.length) return;

    const activate = (target) => {
        buttons.forEach((btn) => {
            const isActive = btn.dataset.focusTarget === target;
            btn.classList.toggle('active', isActive);
        });
    };

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.focusTarget;
            if (!target) return;
            onChange(target);
            activate(target);
        });
    });

    activate('sun');
}

function getFocusPosition(target, earthPos, moonPos) {
    if (target === 'earth') return earthPos;
    if (target === 'moon') return moonPos;
    return [0, 0, 0];
}

// =======================
//  시작
// =======================

window.onload = initWebGL;
