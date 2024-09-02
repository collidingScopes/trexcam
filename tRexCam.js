/*
To do:
Improve performance so that animationfps can be increased
- Can other thresholding / filtering be applied to reduce the number of pixels which need to be analysed?
Option to use more natural palette?
Colours based on shader or background gradient?
Add some visual glitches / noise / randomness
shortcut hotkeys
Adjustable max canvas width?
Put neon pixel color inputs into a folder (auto-hide if Actual colors are selected) 
Are user videos being duplicated? Multiple console calls after many videos are uploaded in a row
Try out some ascii videos as input -- produces an interesting effect
*/

var webcamVideo = document.getElementById('webcamVideo');
var userVideo = document.getElementById('userVideo');
var defaultVideo = document.getElementById('defaultVideo');

//Final animation canvas
var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");

//Canvas for raw still images from video
const canvasRaw = document.getElementById('canvas-video');
const ctx2 = canvasRaw.getContext("2d", {
    willReadFrequently: true,
});

var maxCanvasWidth = 720;

var webcamAspectRatio = 1;
var resizedWebcamWidth = Math.min(maxCanvasWidth,Math.floor(window.innerWidth));
var resizedWebcamHeight = Math.round(resizedWebcamWidth / webcamAspectRatio);

var defaultVideoWidth = 480;
var defaultVideoHeight = 848;
var canvasWidth = defaultVideoWidth;
var canvasHeight = defaultVideoHeight;

canvas.width = canvasWidth;
canvas.height = canvasHeight;

var videoType = "Default";

var effectWidthInput = document.getElementById("effectWidthInput");
effectWidthInput.style.width = canvasWidth;
var effectWidth = Number(effectWidthInput.value)/100;
effectWidthInput.addEventListener("change",refresh);
var effectWidthLabel = document.getElementById("effectWidthLabel");

var animationRequest;
var animationInterval;
var playAnimationToggle = false;
var counter = 0;
var webcamStream;

var mediaRecorder;
var recordedChunks;
var finishedBlob;
var recordingMessageDiv = document.getElementById("videoRecordingMessageDiv");
var recordVideoState = false;
var videoRecordInterval;
var videoEncoder;
var muxer;
var mobileRecorder;
var videofps = 15;
var frameNumber = 0;

var animationfps = 15;

//detect user browser
var ua = navigator.userAgent;
var isSafari = false;
var isFirefox = false;
var isIOS = false;
var isAndroid = false;
if(ua.includes("Safari")){
    isSafari = true;
}
if(ua.includes("Firefox")){
    isFirefox = true;
}
if(ua.includes("iPhone") || ua.includes("iPad") || ua.includes("iPod")){
    isIOS = true;
}
if(ua.includes("Android")){
    isAndroid = true;
}
console.log("isSafari: "+isSafari+", isFirefox: "+isFirefox+", isIOS: "+isIOS+", isAndroid: "+isAndroid);

//CREATE USER GUI MENU
var obj = {
    threshold: 20,
    backgroundColor: "#000000",
    colorType: 'Neon',
    pixelColor: '#1c20dd',
    colorRange: 90,
    colorRandomness: 100,
    pixelOpacity: 80,
    trailPower: 80,
};


var gui = new dat.gui.GUI({ autoPlace:false });
gui.close();
var guiOpenToggle = false;

obj['selectVideo'] = function () {
    videoType = "Select Video";
    changeVideoType();
    //fileInput.click();
};
gui.add(obj, 'selectVideo').name('Upload Video');

obj['useWebcam'] = function () {
    videoType = "Webcam";
    changeVideoType();
};
gui.add(obj, 'useWebcam').name('Use Webcam');

gui.add(obj, "threshold").min(5).max(50).step(1).name('Threshold');
gui.addColor(obj, "backgroundColor").name("Background Color");
gui.add(obj, 'colorType', [ 'Neon', 'Actual'] ).name('Color Type');
gui.addColor(obj, "pixelColor").name("Pixel Color").onFinishChange(updatePixelHue);
gui.add(obj, "colorRange").min(0).max(100).step(1).name('ColorRange');
gui.add(obj, "colorRandomness").min(0).max(360).step(1).name('ColorRandomness');
gui.add(obj, "pixelOpacity").min(0).max(100).step(1).name('Pixel Opacity');
gui.add(obj, "trailPower").min(0).max(100).step(1).name('Trail Power');

obj['pausePlay'] = function () {
    togglePausePlay();
};
gui.add(obj, 'pausePlay').name("Pause/Play");

obj['saveImage'] = function () {
    saveImage();
};
gui.add(obj, 'saveImage').name("Image Export");

obj['saveVideo'] = function () {
    toggleVideoRecord();
};
gui.add(obj, 'saveVideo').name("Start/Stop Video Export");

customContainer = document.getElementById( 'gui' );
customContainer.appendChild(gui.domElement);

var guiCloseButton = document.getElementsByClassName("close-button");
console.log(guiCloseButton.length);
guiCloseButton[0].addEventListener("click",updateGUIState);

var useWebcamButton = document.getElementById("useWebcamButton");
useWebcamButton.addEventListener("click",function(){
    videoType = "Webcam";
    changeVideoType();
});

var currentLumArray = [];
var previousLumArray = [];
var keyPixelArray = [];

var pixelData;
var pixels;

var pixelColorHue = getHueFromHex(obj.pixelColor);

function updatePixelHue(){
    pixelColorHue = getHueFromHex(obj.pixelColor);
    console.log("pixel color hue: "+pixelColorHue);
}

//get still image from video input, then detect / draw pixels that are changing vs. previous frame
function render(){

    //choose video feed
    if(videoType == "Webcam"){
        ctx2.drawImage(webcamVideo, 0, 0, canvasWidth, canvasHeight);
    } else if(videoType == "Select Video"){
        ctx2.drawImage(userVideo, 0, 0, canvasWidth, canvasHeight);
    }  else if(videoType == "Default"){
        ctx2.drawImage(defaultVideo, 0, 0, canvasWidth, canvasHeight);
    }

    pixelData = ctx2.getImageData(0, 0, canvasWidth, canvasHeight);
    pixels = pixelData.data;

    //start with blank canvas on the first frame
    if(counter==0){
        ctx.fillStyle = obj.backgroundColor;
        ctx.globalAlpha = 1;
        ctx.fillRect(0,0,canvasWidth,canvasHeight);
    }

    //get closer to background color each frame (to make trails less intense)
    ctx.fillStyle = obj.backgroundColor;
    ctx.globalAlpha = 1 - (obj.trailPower/100);
    ctx.fillRect(0,0,canvasWidth,canvasHeight);

    for(i=0; i<canvasHeight; i++){
        
        if(counter==0){
            previousLumArray[i] = [];
        }

        for(j=0; j<canvasWidth; j++){

            var currentPixelDataValue = (i * canvasWidth + j) * 4;
            var r = pixels[currentPixelDataValue];
            var g = pixels[currentPixelDataValue+1];
            var b = pixels[currentPixelDataValue+2];

            var currentLum = 0.3 * r + 0.6 * g + 0.1 * b;
            var previousLum;

            if(counter == 0){
                previousLum = currentLum;
            } else {
                previousLum = previousLumArray[i][j];
            }

            previousLumArray[i][j] = currentLum;

            var lumDelta = Math.abs(currentLum - previousLum);
            //var grayValue = Math.min(1, lumDelta / 10) * 255;

            if(lumDelta > obj.threshold){
                //ctx.fillStyle = "rgb("+grayValue+","+grayValue+","+grayValue+")";
                //ctx.fillStyle = "hsl("+counter*2+",80%,50%)";
                if(obj.colorType == "Neon"){
                    var currentHue = ( pixelColorHue + (Math.sin(counter/5)*obj.colorRange) + Math.random()*obj.colorRandomness - obj.colorRandomness/2 ) % 360;
                    ctx.fillStyle = "hsl("+currentHue+",80%,50%)";
                    //ctx.fillStyle = "hsl("+pixelColorHue+",80%,50%)";
                } else if(obj.colorType == "Actual"){
                    ctx.fillStyle = "rgb("+r+","+g+","+b+")";
                }
                ctx.globalAlpha = obj.pixelOpacity/100;
                ctx.fillRect(j,i,1,1);
            }

        }

    }

}

//animation loop to go frame by frame
function loop(){

    if(playAnimationToggle){
        
        render();
        counter++;

        if(recordVideoState == true){
            renderCanvasToVideoFrameAndEncode({
                canvas,
                videoEncoder,
                frameNumber,
                videofps
            })
            frameNumber++;
        }
        
    }
}

//HELPER FUNCTIONS BELOW

/*
function selectVideo(){
    videoType = "Select Video";
    fileInput.click();
}
*/

function updateGUIState(){
    if(guiOpenToggle){
        guiOpenToggle = false;
    } else {
        guiOpenToggle = true;
    }
}

function refresh(){
    console.log("refresh");
    console.log("canvas width/height: "+canvasWidth+", "+canvasHeight);

    document.getElementById("canvasDiv").setAttribute("style", "width: "+canvasWidth+"px;");

}

function togglePausePlay(){
    
    if(playAnimationToggle == false){
        if(videoType == "Webcam"){
            startWebcam();
        } else if(videoType == "Select Video"){
            //refresh();
            userVideo.play();
            playAnimationToggle = true;
            //animationRequest = requestAnimationFrame(loop);
            animationInterval = setInterval(loop,1000/animationfps);
        } else if(videoType == "Default"){
            startDefaultVideo();
        }
    } else {
        stopVideo();
    }
    
}

function changeVideoType(){
    stopVideo();

    if(videoType == "Webcam"){
        startWebcam();

    } else if(videoType == "Select Video"){
        console.log("select video file");
        //selectVideo();
        fileInput.click();

    } else if(videoType == "Default"){
        startDefaultVideo();
    }

    counter = 0;
    //refresh();

}

function startDefaultVideo(){
    if(playAnimationToggle==true){
        playAnimationToggle = false;
        //cancelAnimationFrame(animationRequest);
        clearInterval(animationInterval);
        console.log("cancel animation");
    }

    canvasWidth = defaultVideoWidth;
    canvasHeight = defaultVideoHeight;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    canvasRaw.width = canvasWidth;
    canvasRaw.height = canvasHeight;

    defaultVideo.play();
    userVideo.pause();
    webcamVideo.pause();

    playAnimationToggle = true;
    //animationRequest = requestAnimationFrame(loop);
    animationInterval = setInterval(loop,1000/animationfps);
}

function startWebcam() {

    if(playAnimationToggle==true){
        playAnimationToggle = false;
        //cancelAnimationFrame(animationRequest);
        clearInterval(animationInterval);

        console.log("cancel animation");
    }

    userVideo.pause();
    defaultVideo.pause();

    navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true
    })
    .then(stream => {
        window.localStream = stream;
        webcamVideo.srcObject = stream;
        webcamVideo.play();
        if(isIOS || isAndroid){
            webcamAspectRatio = 3/4;
        } else {
            webcamAspectRatio = stream.getVideoTracks()[0].getSettings().aspectRatio;
        }

        if(webcamAspectRatio == undefined){
            webcamAspectRatio = 1.33333;
        }
        console.log("Aspect Ratio: "+webcamAspectRatio);

        resizedWebcamWidth = Math.min(maxCanvasWidth,Math.floor(window.innerWidth));
        resizedWebcamHeight = Math.round(resizedWebcamWidth / webcamAspectRatio);
    
        canvasWidth = resizedWebcamWidth;
        canvasHeight = resizedWebcamHeight;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        canvasRaw.width = canvasWidth;
        canvasRaw.height = canvasHeight;

        //refresh();

        playAnimationToggle = true;
        //animationRequest = requestAnimationFrame(loop);
        animationInterval = setInterval(loop,1000/animationfps);
    })
    .catch((err) => {
        console.log(err);
    });

}

var fileInput = document.getElementById("fileInput");
fileInput.addEventListener('change', (e) => {

    stopVideo();

    if(playAnimationToggle==true){
        playAnimationToggle = false;
        //cancelAnimationFrame(animationRequest);
        clearInterval(animationInterval);

        console.log("cancel animation");
    }

    videoType = "Select Video";
    counter = 0;

    const file = e.target.files[0];
    const url = URL.createObjectURL(file);
    userVideo.src = url;
    userVideo.addEventListener('loadedmetadata', () => {
        
        userVideo.width = userVideo.videoWidth;
        userVideo.height = userVideo.videoHeight;
        console.log("user video width/height: "+userVideo.width+", "+userVideo.height);

        canvasWidth = Math.min(userVideo.videoWidth, maxCanvasWidth);
        canvasHeight = Math.floor(canvasWidth * (userVideo.videoHeight / userVideo.videoWidth)); 

        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        canvasRaw.width = canvasWidth;
        canvasRaw.height = canvasHeight;

    });
    
    setTimeout(function(){
        userVideo.play();
        defaultVideo.pause();
        webcamVideo.pause();

        //refresh();
        playAnimationToggle = true;
        //animationRequest = requestAnimationFrame(loop);
        animationInterval = setInterval(loop,1000/animationfps);
    },2000);

});

var localStream;
function stopVideo(){

    if(playAnimationToggle==true){
        playAnimationToggle = false;
        //cancelAnimationFrame(animationRequest);
        clearInterval(animationInterval);

        console.log("cancel animation");
    }

    webcamVideo.pause();
    userVideo.pause();
    defaultVideo.pause();

    if(localStream == null){
    } else {
        localStream.getVideoTracks()[0].stop();
    }
}

function getAverageColor(chosenPixels) {
    var r = 0;
    var g = 0;
    var b = 0;
    var count = chosenPixels.length / 4;
    for (let i = 0; i < count; i++) {
        r += chosenPixels[i * 4];
        g += chosenPixels[i * 4 + 1];
        b += chosenPixels[i * 4 + 2];
    }
    return [r / count, g / count, b / count];
}

function getHueFromHex(hex) {
    const rgb = hexToRgb(hex);
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
  
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
  
    let hue = 0;
  
    if (delta === 0) {
      hue = 0;
    } else if (max === r) {
      hue = (g - b) / delta;
    } else if (max === g) {
      hue = 2 + (b - r) / delta;
    } else {
      hue = 4 + (r - g) / delta;
    }
  
    hue *= 60;
    if (hue < 0) {
      hue += 360;
    }
  
    return hue;
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function rgbToHue(r, g, b) {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    const hue = Math.atan2(Math.sqrt(3) * (gNorm - bNorm), 2 * rNorm - gNorm - bNorm);
    return hue * 180 / Math.PI;
}

function rgbToSaturation(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return (max - min) / max;
}

function rgbToLightness(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return (max + min) / 2 / 255;
}

function interpolateHex(hex1,hex2,factor){
    hex1RGB = hexToRgb(hex1);
    hex2RGB = hexToRgb(hex2);

    var newR = Math.round(hex1RGB.r + (hex2RGB.r - hex1RGB.r)*factor);
    var newG = Math.round(hex1RGB.g + (hex2RGB.g - hex1RGB.g)*factor);
    var newB = Math.round(hex1RGB.b + (hex2RGB.b - hex1RGB.b)*factor);

    var rgbResult = "rgb("+newR+","+newG+","+newB+")";
    return rgbResult;
}

function tweakHexColor(hexColor, range){
    var rgb = hexToRgb(hexColor);
  
    var newRGBArray = [];
  
    newRGBArray.push(Math.floor(rgb.r+range*Math.random()-range/2));
    newRGBArray.push(Math.floor(rgb.b+range*Math.random()-range/2));
    newRGBArray.push(Math.floor(rgb.g+range*Math.random()-range/2));
  
    var newHexColor = rgbToHex(newRGBArray[0],newRGBArray[1],newRGBArray[2]);
    return newHexColor;
}

function rgbToHex(r, g, b) {
    return "#" + (
      (r.toString(16).padStart(2, "0")) +
      (g.toString(16).padStart(2, "0")) +
      (b.toString(16).padStart(2, "0"))
    );
}

/*
//shortcut hotkey presses
document.addEventListener('keydown', function(event) {
  
    if(event.shiftKey && event.key == 'p'){
        togglePausePlay();
    } else if (event.key === 'i' && event.shiftKey) {
        saveImage();
    } else if (event.key === 'v' && event.shiftKey) {
        toggleVideoRecord();
    } else if (event.key === 'o' && event.shiftKey) {
        dat.GUI.toggleHide();
    } 
   
});

//shortcut hotkey presses
document.addEventListener('keydown', function(event) {
  
    if(event.key === 'h') {
        toggleGUI();
    } 
   
});
*/

function saveImage(){
    const link = document.createElement('a');
    link.href = canvas.toDataURL();

    const date = new Date();
    const filename = `ASCII_${date.toLocaleDateString()}_${date.toLocaleTimeString()}.png`;
    link.download = filename;
    link.click();
}

function toggleGUI(){
    
    if(guiOpenToggle == false){
        gui.open();
        guiOpenToggle = true;
    } else {
        gui.close();
        guiOpenToggle = false;
    }
    
}

function toggleVideoRecord(){

    userVideo.currentTime = 0;
    defaultVideo.currentTime = 0;

    setTimeout(function(){
        if(recordVideoState == false){
            recordVideoState = true;
            chooseRecordingFunction();
          } else {
            recordVideoState = false;
            chooseEndRecordingFunction();
          }
    },250);

}

function chooseRecordingFunction(){
    if(isIOS || isAndroid || isFirefox){
        startMobileRecording();
    }else {
        recordVideoMuxer();
    }
}

function chooseEndRecordingFunction(){
    if(isIOS || isAndroid || isFirefox){
        mobileRecorder.stop();
    }else {
        finalizeVideo();
    }
}

//record html canvas element and export as mp4 video
//source: https://devtails.xyz/adam/how-to-save-html-canvas-to-mp4-using-web-codecs-api
async function recordVideoMuxer() {
    console.log("start muxer video recording");
    var videoWidth = Math.floor(canvas.width/2)*2;
    var videoHeight = Math.floor(canvas.height/8)*8; //force a number which is divisible by 8
    console.log("Video dimensions: "+videoWidth+", "+videoHeight);

    frameNumber = 0;

    //display user message
    //recordingMessageCountdown(videoDuration);
    recordingMessageDiv.classList.remove("hidden");

    recordVideoState = true;
    const ctx = canvas.getContext("2d", {
        // This forces the use of a software (instead of hardware accelerated) 2D canvas
        // This isn't necessary, but produces quicker results
        willReadFrequently: true,
        // Desynchronizes the canvas paint cycle from the event loop
        // Should be less necessary with OffscreenCanvas, but with a real canvas you will want this
        desynchronized: true,
    });

    muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
    //let muxer = new Muxer({
        //target: new ArrayBufferTarget(),
        video: {
            // If you change this, make sure to change the VideoEncoder codec as well
            codec: "avc",
            width: videoWidth,
            height: videoHeight,
        },

        firstTimestampBehavior: 'offset', 

        // mp4-muxer docs claim you should always use this with ArrayBufferTarget
        fastStart: "in-memory",
    });

    videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => console.error(e),
    });

    // This codec should work in most browsers
    // See https://dmnsgn.github.io/media-codecs for list of codecs and see if your browser supports
    videoEncoder.configure({
        codec: "avc1.42003e",
        width: videoWidth,
        height: videoHeight,
        bitrate: 14_000_000,
        bitrateMode: "constant",
    });
    //NEW codec: "avc1.42003e",
    //ORIGINAL codec: "avc1.42001f",

    /*
    var frameNumber = 0;
    //setTimeout(finalizeVideo,1000*videoDuration+200); //finish and export video after x seconds
    */

    /*
    //take a snapshot of the canvas every x miliseconds and encode to video
    videoRecordInterval = setInterval(
        function(){
            if(recordVideoState == true){
                renderCanvasToVideoFrameAndEncode({
                    canvas,
                    videoEncoder,
                    frameNumber,
                    videofps
                })
                frameNumber++;
            }else{
            }
        } , 1000/videofps);
    */
    

}

//finish and export video
async function finalizeVideo(){
    console.log("finalize muxer video");
    clearInterval(videoRecordInterval);
    recordVideoState = false;
    // Forces all pending encodes to complete
    await videoEncoder.flush();
    muxer.finalize();
    let buffer = muxer.target.buffer;
    finishedBlob = new Blob([buffer]); 
    downloadBlob(new Blob([buffer]));

    //hide user message
    recordingMessageDiv.classList.add("hidden");

}

async function renderCanvasToVideoFrameAndEncode({
    canvas,
    videoEncoder,
    frameNumber,
    videofps,
    }) {
    let frame = new VideoFrame(canvas, {
        // Equally spaces frames out depending on frames per second
        timestamp: (frameNumber * 1e6) / videofps,
    });

    // The encode() method of the VideoEncoder interface asynchronously encodes a VideoFrame
    videoEncoder.encode(frame);

    // The close() method of the VideoFrame interface clears all states and releases the reference to the media resource.
    frame.close();
}

function downloadBlob() {
    console.log("download video");
    let url = window.URL.createObjectURL(finishedBlob);
    let a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    const date = new Date();
    const filename = `ASCII_${date.toLocaleDateString()}_${date.toLocaleTimeString()}.mp4`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
}

//record and download videos on mobile devices
function startMobileRecording(){
    var stream = canvas.captureStream(videofps);
    mobileRecorder = new MediaRecorder(stream, { 'type': 'video/mp4' });
    mobileRecorder.addEventListener('dataavailable', finalizeMobileVideo);

    console.log("start simple video recording");
    console.log("Video dimensions: "+canvas.width+", "+canvas.height);

    //display user message
    //recordingMessageCountdown(videoDuration);
    recordingMessageDiv.classList.remove("hidden");

    recordVideoState = true;
    mobileRecorder.start(); //start mobile video recording

    /*
    setTimeout(function() {
        recorder.stop();
    }, 1000*videoDuration+200);
    */
}

function finalizeMobileVideo(e) {
setTimeout(function(){
    console.log("finish simple video recording");
    recordVideoState = false;
    /*
    mobileRecorder.stop();*/
    var videoData = [ e.data ];
    finishedBlob = new Blob(videoData, { 'type': 'video/mp4' });
    downloadBlob(finishedBlob);
    
    //hide user message
    recordingMessageDiv.classList.add("hidden");

},500);

}

//MAIN METHOD
//refresh();
startDefaultVideo();