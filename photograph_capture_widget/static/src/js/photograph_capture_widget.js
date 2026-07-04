/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, useRef, onWillStart, onWillUpdateProps } from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { isBinarySize } from "@web/core/utils/binary";
import { CameraCapture } from "./camera_capture";

class PhotographCaptureWidget extends Component {
    static template = "photograph_capture_widget.PhotographCaptureWidget";
    static components = { CameraCapture };
    static props = { ...standardFieldProps };

    setup() {
        this.state = useState({ isCapturing: false, preview: null, showLightbox: false });
        this.uploadInputRef = useRef("uploadInput");

        onWillStart(() => this._syncPreview());
        onWillUpdateProps(() => this._syncPreview());
    }

    _syncPreview() {
        const val = this.props.record.data[this.props.name];
        if (!val) {
            this.state.preview = null;
        } else if (isBinarySize(val)) {
            // Saved record: Odoo returns the size string, not base64 — use image URL
            const { resModel, resId } = this.props.record;
            this.state.preview = resId
                ? `/web/image/${resModel}/${resId}/${this.props.name}?unique=${resId}`
                : null;
        } else {
            // Unsaved/in-memory base64 data
            this.state.preview = `data:image/jpeg;base64,${val}`;
        }
    }

    get isReadonly() {
        return this.props.readonly;
    }

    get containerStyle() {
        const opts = this.props.options || {};
        const parts = [];
        if (opts.width) parts.push(`width: ${opts.width}px`);
        if (opts.height) parts.push(`max-height: ${opts.height}px`);
        return parts.join('; ');
    }

    get previewImgStyle() {
        const opts = this.props.options || {};
        const parts = ['cursor: zoom-in', 'width: 100px', 'height: 50px'];
        if (opts.height) parts.push(`height: ${opts.height}px`, 'object-fit: cover');
        return parts.join('; ');
    }

    openCamera() {
        this.state.isCapturing = true;
    }

    async onCapture(base64) {
        this.state.preview = `data:image/jpeg;base64,${base64}`;
        await this.props.record.update({ [this.props.name]: base64 });
        this.state.isCapturing = false;
    }

    onClose() {
        this.state.isCapturing = false;
    }

    openLightbox() {
        this.state.showLightbox = true;
    }

    closeLightbox() {
        this.state.showLightbox = false;
    }

    async clearPhoto() {
        this.state.preview = null;
        await this.props.record.update({ [this.props.name]: false });
    }

    triggerUpload() {
        this.uploadInputRef.el.click();
    }

    async onUpload(ev) {
        const file = ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target.result;
            const base64 = dataUrl.split(',')[1];
            this.state.preview = dataUrl;
            await this.props.record.update({ [this.props.name]: base64 });
        };
        reader.readAsDataURL(file);
        ev.target.value = '';
    }
}

registry.category("fields").add("photograph_capture", {
    component: PhotographCaptureWidget,
    displayName: "Photograph Capture",
    supportedTypes: ["binary"],
});
