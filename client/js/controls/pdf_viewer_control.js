"use strict";

const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "js/pdf.worker.min.js",
    document.baseURI
).toString();

class PdfViewerControl {
    constructor(hostNode) {
        this._hostNode = hostNode;
        this._pdfUrl = new URL(
            hostNode.dataset.pdfUrl,
            document.baseURI
        ).toString();
        this._document = null;
        this._loadingTask = null;
        this._renderTask = null;
        this._pageNumber = 1;
        this._zoom = 1;
        this._renderRequest = 0;
        this._destroyed = false;

        this._buildViewer();
        this._loadDocument();
    }

    resize() {
        if (this._document) {
            this._renderPage();
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._renderTask) {
            this._renderTask.cancel();
        }
        if (this._loadingTask) {
            this._loadingTask.destroy();
        }
    }

    _buildViewer() {
        this._hostNode.innerHTML = "";
        this._toolbar = document.createElement("div");
        this._toolbar.className = "pdf-toolbar";

        this._previousButton = this._makeButton("Previous", () => {
            this._setPage(this._pageNumber - 1);
        });
        this._pageLabel = document.createElement("span");
        this._pageLabel.className = "pdf-page-label";
        this._nextButton = this._makeButton("Next", () => {
            this._setPage(this._pageNumber + 1);
        });
        this._zoomOutButton = this._makeButton("Zoom out", () => {
            this._zoom = Math.max(0.5, this._zoom - 0.25);
            this._renderPage();
        });
        this._zoomInButton = this._makeButton("Zoom in", () => {
            this._zoom = Math.min(3, this._zoom + 0.25);
            this._renderPage();
        });

        const openLink = document.createElement("a");
        openLink.href = this._pdfUrl;
        openLink.target = "_blank";
        openLink.rel = "noopener noreferrer";
        openLink.textContent = "Open PDF";

        this._toolbar.appendChild(this._previousButton);
        this._toolbar.appendChild(this._pageLabel);
        this._toolbar.appendChild(this._nextButton);
        this._toolbar.appendChild(this._zoomOutButton);
        this._toolbar.appendChild(this._zoomInButton);
        this._toolbar.appendChild(openLink);

        this._status = document.createElement("div");
        this._status.className = "pdf-status";
        this._status.setAttribute("role", "status");
        this._status.textContent = "Loading PDF…";

        this._canvas = document.createElement("canvas");
        this._canvas.className = "pdf-page";
        this._canvas.setAttribute("aria-label", "PDF page");

        this._hostNode.appendChild(this._toolbar);
        this._hostNode.appendChild(this._status);
        this._hostNode.appendChild(this._canvas);
    }

    _makeButton(text, callback) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.addEventListener("click", callback);
        return button;
    }

    _loadDocument() {
        this._loadingTask = pdfjs.getDocument({
            url: this._pdfUrl,
            rangeChunkSize: 65536,
        });
        this._loadingTask.onProgress = (progress) => {
            if (
                !this._destroyed &&
                !this._document &&
                progress.total &&
                progress.loaded < progress.total
            ) {
                this._status.textContent =
                    "Loading PDF… " +
                    Math.floor((progress.loaded / progress.total) * 100) +
                    "%";
            }
        };
        this._loadingTask.promise.then(
            (document) => {
                if (this._destroyed) {
                    document.destroy();
                    return;
                }
                this._document = document;
                this._renderPage();
            },
            (error) => {
                if (!this._destroyed) {
                    this._status.textContent =
                        "Unable to load PDF: " + error.message;
                    this._status.classList.add("error");
                }
            }
        );
    }

    _setPage(pageNumber) {
        if (
            !this._document ||
            pageNumber < 1 ||
            pageNumber > this._document.numPages
        ) {
            return;
        }
        this._pageNumber = pageNumber;
        this._renderPage();
    }

    _renderPage() {
        if (!this._document || this._destroyed) {
            return;
        }
        const request = ++this._renderRequest;
        if (this._renderTask) {
            this._renderTask.cancel();
            this._renderTask = null;
        }

        this._status.textContent = "Rendering page " + this._pageNumber + "…";
        this._document
            .getPage(this._pageNumber)
            .then((page) => {
                if (this._destroyed || request !== this._renderRequest) {
                    return;
                }
                const baseViewport = page.getViewport({ scale: 1 });
                const availableWidth = Math.max(
                    1,
                    this._hostNode.clientWidth - 32
                );
                const availableHeight = Math.max(
                    1,
                    this._hostNode.clientHeight -
                        this._toolbar.offsetHeight -
                        64
                );
                const fitScale = Math.min(
                    availableWidth / baseViewport.width,
                    availableHeight / baseViewport.height
                );
                const viewport = page.getViewport({
                    scale: fitScale * this._zoom,
                });
                const outputScale = Math.min(window.devicePixelRatio || 1, 2);
                const context = this._canvas.getContext("2d");

                this._canvas.width = Math.floor(viewport.width * outputScale);
                this._canvas.height = Math.floor(viewport.height * outputScale);
                this._canvas.style.width = Math.floor(viewport.width) + "px";
                this._canvas.style.height = Math.floor(viewport.height) + "px";
                this._pageLabel.textContent =
                    "Page " +
                    this._pageNumber +
                    " / " +
                    this._document.numPages;
                this._previousButton.disabled = this._pageNumber <= 1;
                this._nextButton.disabled =
                    this._pageNumber >= this._document.numPages;

                const renderTask = page.render({
                    canvasContext: context,
                    viewport: viewport,
                    transform:
                        outputScale === 1
                            ? null
                            : [outputScale, 0, 0, outputScale, 0, 0],
                });
                this._renderTask = renderTask;
                renderTask.promise.then(
                    () => {
                        if (this._renderTask === renderTask) {
                            this._renderTask = null;
                        }
                        if (
                            !this._destroyed &&
                            request === this._renderRequest
                        ) {
                            this._status.textContent = "";
                        }
                    },
                    (error) => {
                        if (this._renderTask === renderTask) {
                            this._renderTask = null;
                        }
                        if (
                            !this._destroyed &&
                            request === this._renderRequest &&
                            error.name !== "RenderingCancelledException"
                        ) {
                            this._showError(
                                "Unable to render PDF page: " + error.message
                            );
                        }
                    }
                );
            })
            .catch((error) => {
                if (!this._destroyed && request === this._renderRequest) {
                    this._showError(
                        "Unable to load PDF page: " + error.message
                    );
                }
            });
    }

    _showError(message) {
        this._status.textContent = message;
        this._status.classList.add("error");
    }
}

module.exports = PdfViewerControl;
