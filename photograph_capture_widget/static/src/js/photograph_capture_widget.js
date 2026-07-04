/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, useRef } from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { isBinarySize } from "@web/core/utils/binary";
import { url } from "@web/core/utils/urls";
import { CameraCapture } from "./camera_capture";

const fileTypeMagicMap = {
    "/": "jpeg",
    R: "gif",
    i: "png",
    P: "svg+xml",
};

class PhotographCaptureWidget extends Component {
    static template = "photograph_capture_widget.PhotographCaptureWidget";
    static components = { CameraCapture };
    static props = { ...standardFieldProps };

    setup() {
        this.state = useState({ isCapturing: false, showLightbox: false });
        this.uploadInputRef = useRef("uploadInput");
    }

    get previewUrl() {
        const val = this.props.value;
        if (!val) return false;
        if (isBinarySize(val)) {
            return url("/web/image", {
                model: this.props.record.resModel,
                id: this.props.record.resId,
                field: this.props.name,
                unique: this.props.record.data.__last_update || this.props.record.resId,
            });
        }
        const magic = fileTypeMagicMap[val[0]] || "jpeg";
        return `data:image/${magic};base64,${val}`;
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
        const magic = fileTypeMagicMap[base64[0]] || "jpeg";
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
            await this.props.record.update({ [this.props.name]: base64 });
        };
        reader.readAsDataURL(file);
        ev.target.value = '';
    }
}

PhotographCaptureWidget.fieldDependencies = {
    __last_update: { type: "datetime" },
};

registry.category("fields").add("photograph_capture", PhotographCaptureWidget);
