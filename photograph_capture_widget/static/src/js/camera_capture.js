/** @odoo-module **/
import { Component, useState, useRef, onMounted, onWillUnmount } from "@odoo/owl";

export class CameraCapture extends Component {
    static template = "photograph_capture_widget.CameraCapture";
    static props = {
        onCapture: Function,
        onClose: Function,
    };

    setup() {
        this.state = useState({ facingMode: "environment", error: null });
        this.stream = null;
        this.videoRef = useRef("video");
        this.canvasRef = useRef("canvas");

        onMounted(() => this._startStream());
        onWillUnmount(() => this._stopStream());
    }

    async switchCamera() {
        this.state.facingMode = this.state.facingMode === "environment" ? "user" : "environment";
        await this._startStream();
    }

    async _startStream() {
        this._stopStream();
        this.state.error = null;
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: this.state.facingMode },
            });
            const video = this.videoRef.el;
            if (video) {
                video.srcObject = this.stream;
                await video.play();
            }
        } catch (e) {
            console.error("Camera error:", e);
            this.state.error = "Camera not available or permission denied.";
        }
    }

    capturePhoto() {
        const video = this.videoRef.el;
        const canvas = this.canvasRef.el;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        const base64 = canvas.toDataURL("image/jpeg").split(",")[1];
        this._stopStream();
        this.props.onCapture(base64);
    }

    cancel() {
        this._stopStream();
        this.props.onClose();
    }

    _stopStream() {
        if (this.stream) {
            this.stream.getTracks().forEach((t) => t.stop());
            this.stream = null;
        }
    }
}
