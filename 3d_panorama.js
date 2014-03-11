/**
 * @overview 3D-panorama
 * @module 3d_panorama
 * @exports Panorama
 * @requires requirejs
 * @requires jquery
 * @requires jquery.mousewheel
 * @requires three
 *
 * @author Viacheslav Lotsmanov
 * @copyright Based on panorama demo of three.js (http://mrdoob.github.io/three.js/examples/canvas_geometry_panorama.html)
 * @license GPLv3
 */

define(['jquery', 'three', 'jquery.mousewheel'],
/** @lends Panorama */
function ($, THREE) {
    var sides = ['right', 'left', 'top', 'bottom', 'back', 'front'];

    /**
     * @description You need to set "params" keys "panoramaCode" and "imgPathMask" both or absolute paths to key "sideTextures"
     * @name Panorama
     * @constructor
     * @public
     *
     * @param {jQuery|string|DOM} $selector jQuery object of container or string of selector or DOM-element
     * @param {Panorama~params} params Parameters
     * @param {Panorama~createInstanceCallback} [callback] Callback after instance created (asynchronus)
     *
     * @exception {Panorama~IncorrectArgument}
     * @exception {Panorama~RequiredParameter}
     * @exception {Panorama~RequiredSideTexture}
     * @exception {Panorama~NoContainer}
     * @exception {Panorama~ContainerZeroSize}
     * @exception {Panorama~SinglePanoramaPerContainer}
     */
    function Panorama($selector, params/*[, callback]*/) {
        var self = this;

        if (!$.isPlainObject(params)) {
            self._makeError(new self.exceptions.IncorrectArgument());
            return false;
        }

        /**
         * @callback Panorama~createInstanceCallback
         * @param {Error|Null} err Exception instance or null if no errors
         * @this {Panorama} Instance of Panorama
         */
        /** @private */ this._callback = null;

        // Parse optional arguments
        if (!Array.prototype.slice.call(arguments, 2).every(function (arg, i) {
            if (i > 0) {
                self._makeError(new self.exceptions.IncorrectArgument());
                return false;
            }

            if ($.type(arg) === 'function') {
                if (!self._callback) {
                    self._callback = arg;
                } else {
                    self._makeError(new self.exceptions.IncorrectArgument());
                    return false;
                }
            } else {
                self._makeError(new self.exceptions.IncorrectArgument());
                return false;
            }

            return true;
        })) return false;

        /**
         * @typedef Panorama~params
         * @type {Object.<*>}
         * @prop {string} panoramaCode Specific name of panorama for replacing in imgPathMask
         * @prop {string} imgPathMask Mask of path to image file of side of the panorama
         * @prop {Array.<string>} [sideNames='right', 'left', 'top', 'bottom', 'back', 'front'] Side names (for imgPathMask)
         * @prop {Panorama~sideTextures} [sideTextures=null] Key-value object of absolute paths to side-textures
         * @prop {number} [startFov=75] Start fov value
         * @prop {number} [minFov=10] Minimal fov value (for zoom)
         * @prop {number} [maxFov=75] Maximum fov value (for zoom)
         * @prop {float} [fovMouseStep=2.0] Step of zoom by mouse wheel
         */
        /** @private */ this._params = $.extend({

            // default values

            panoramaCode: null,
            imgPathMask: null,
            sideNames: sides.slice(0), // clone

            /**
             * @typedef Panorama~sideTextures
             * @type {Object.<string>}
             * @prop {string} right Example: '/panorama/right.png'
             * @prop {string} left Example: '/panorama/right.png'
             * @prop {string} top Example: '/panorama/top.png'
             * @prop {string} bottom Example: '/panorama/bottom.png'
             * @prop {string} back Example: '/panorama/back.png'
             * @prop {string} front Example: '/panorama/front.png'
             */
            sideTextures: null,

            startFov: 75,
            minFov: 10,
            maxFov: 75,
            fovMouseStep: 2.0,

        }, params);

        // check for required parameters
        if (this._params.sideTextures === null) {
            if (this._params.panoramaCode === null
            || this._params.imgPathMask === null) {
                this._makeError(new this.exceptions.RequiredParameter());
                return false;
            }
        } else {
            if (!sides.every(function (side) {
                if (!(side in self._params.sideTextures)) {
                    self._makeError(
                        new self.exceptions
                            .RequiredSideTexture('No '+side+' side texture')
                    );
                    return false;
                }
                return true;
            })) return false;
        }

        /**
         * Container of the panorama
         *
         * @type jQuery
         * @public
         * @instance
         */
        this.$container = $($selector);

        if (this.$container.size() < 1) {
            this._makeError(new this.exceptions.NoContainer());
            return false;
        }
        if (this.$container.width() < 1 || this.$container.height() < 1) {
            this._makeError(new this.exceptions.ContainerZeroSize());
            return false;
        }

        if (this.$container.data('panorama')) {
            this._makeError(new this.exceptions.SinglePanoramaPerContainer());
            return false;
        }

        /**
         * @type string
         * @public
         * @instance
         */
        this.panoramaId = 'panorama_id_'
            + (new Date()).getTime()
            + Math.round(Math.random() * 1000000000);

        /** @private */ this._camera = new THREE.PerspectiveCamera(
            this._params.startFov,
            this.$container.width() / this.$container.height(),
            1, 1000
        );
        /** @private */ this._scene = new THREE.Scene();

        /** @private */ this._$texturePlaceholder = $('<canvas/>');
        this._$texturePlaceholder.width(128);
        this._$texturePlaceholder.height(128);

        /** @private */ this._textureContext
            = this._$texturePlaceholder.get(0).getContext('2d');
        this._textureContext.fillStyle = 'rgb(200, 200, 200)';
        this._textureContext.fillRect(
            0, 0,
            this._$texturePlaceholder.width(),
            this._$texturePlaceholder.height()
        );

        /** @private */ this._materials = [];
        if (this._params.sideTextures === null) {
            this._params.sideNames.every(function (side) {
                self._materials.push(
                    self._loadTexture(
                        self._params.imgPathMask
                            .replace(
                                /#PANORAMA_CODE#/g,
                                self._params.panoramaCode
                            )
                            .replace(/#SIDE#/g, side)
                    )
                );
                return true;
            });
        } else {
            sides.every(function (side) {
                self._materials.push(self._loadTexture(
                    self._params.sideTextures[side]
                ));
                return true;
            });
        }

        /** @private */ this._mesh = new THREE.Mesh(
            new THREE.BoxGeometry(300, 300, 300, 7, 7, 7),
            new THREE.MeshFaceMaterial(this._materials)
        );
        this._mesh.scale.x = -1;
        this._scene.add(this._mesh);

        /** @private */ this._target = new THREE.Vector3();
        /** @private */ this._lon = 90.0;
        /** @private */ this._lat = 0.0;
        /** @private */ this._phi = 0.0;
        /** @private */ this._theta = 0.0;
        /** @private */ this._holdByUser = false;

        /** @private */ this._renderer = new THREE.CanvasRenderer();
        this._renderer.setSize(
            this.$container.width(),
            this.$container.height()
        );

        /**
         * Wrapper of the panorama that putted to container of the panorama
         *
         * @type jQuery
         * @public
         * @instance
         */
        this.$panoramaWrapper = $('<div/>').addClass('panorama_wrapper');

        this.$panoramaWrapper.html( this._renderer.domElement );
        this.$container.append( this.$panoramaWrapper );

        this.$container.data('panorama', this);

        /**
         * @private
         * @instance
         * @type function
         */
        this._resizeHandlerWrapper
        = function resizeHandlerWrapper() {
            self.handlers.resizeHandler.call(this, self);
        };

        $(window).bind(
            'resize.' + this.panoramaId,
            this._resizeHandlerWrapper
        );

        /** move camera by mouse */
        this.$container.bind(
            'mousedown.' + this.panoramaId,
            this.handlers.mouseDownHandler
        );
        this.$container.bind(
            'mousemove.' + this.panoramaId,
            this.handlers.mouseMoveHandler
        );
        this.$container.bind(
            'mouseup.' + this.panoramaId,
            this.handlers.mouseUpHandler
        );

        /** zoom by mouse scroll */
        this.$container.bind(
            'mousewheel.' + this.panoramaId,
            this.handlers.mouseWheelHandler
        );

        /** move camera by touch pad */
        this.$container.bind(
            'touchstart.' + this.panoramaId,
            this.handlers.touchStartHandler
        );
        this.$container.bind(
            'touchmove.' + this.panoramaId,
            this.handlers.touchMoveHandler
        );
        this.$container.bind(
            'touchend.' + this.panoramaId,
            this.handlers.touchEndHandler
        );

        // draw first frame
        this.draw();

        if (this._callback) {
            setTimeout(function () {
                self._callback.call(self, null);
            }, 1);
        }
    }

    /**
     * Load texture helper
     *
     * @memberOf Panorama
     * @param {string} path Path to texture image file
     * @private
     * @static
     * @returns {THREE~Texture}
     */
    Panorama.prototype._loadTexture
    = function loadTexture(path) {
        var texture = new THREE.Texture(this._$texturePlaceholder.get(0));
        var material = new THREE.MeshBasicMaterial({
            map: texture,
            overdraw: true
        });

        $('<img/>').load(function () {
            texture.image = this;
            texture.needsUpdate = true;
        }).attr('src', path);

        return material;
    };

    /**
     * Animation loop
     *
     * @memberOf Panorama
     * @public
     * @static
     */
    Panorama.prototype.animationLoop
    = function animationLoop() {
        var self = this;
        requestAnimationFrame(function () {
            if (!self.animationLoop) return;
            self.animationLoop.call(self);
        });
        self.draw();
    };

    /**
     * Draw panorama frame
     *
     * @memberOf Panorama
     * @public
     * @static
     */
    Panorama.prototype.draw
    = function draw() {
        if (this._holdByUser === false) this._lon += 0.1;
        if (this._lon >= 360.0) this._lon = 0.0;

        this._lat = Math.max( -85.0, Math.min(85.0, this._lat) );
        this._phi = THREE.Math.degToRad(90.0 - this._lat);
        this._theta = THREE.Math.degToRad(this._lon);

        this._target.x = 500.0 * Math.sin(this._phi) * Math.cos(this._theta);
        this._target.y = 500.0 * Math.cos(this._phi);
        this._target.z = 500.0 * Math.sin(this._phi) * Math.sin(this._theta);

        this._camera.lookAt(this._target);
        this._renderer.render(this._scene, this._camera);
    };

    /**
     * Destroy the constructor instance
     *
     * @memberOf Panorama
     * @public
     * @static
     */
    Panorama.prototype.destroy
    = function destroy() {
        this.$container.unbind('.' + this.panoramaId);
        $(window).unbind('.' + this.panoramaId);
        this.$panoramaWrapper.remove();
        this.$container.removeData('panorama');
        for (var key in this) {try {this[key] = void(0);} catch(e) {}}
    };

    /**
     * Throw error or delegate to callback
     *
     * @memberOf Panorama
     * @private
     * @static
     * @param {Error} exception
     */
    Panorama.prototype._makeError
    = function makeError(exception) {
        var self = this;
        if (this._callback) {
            setTimeout(function () {
                self._callback.call(self, exception);
                self.destroy();
            }, 1);
            return true;
        }
        throw exception;
    };

    /**
     * Panorama exceptions
     *
     * @memberOf Panorama
     * @public
     * @type {Object.<Error>}
     * @prop {Panorama~IncorrectArgument} IncorrectArgument Incorrect argument of constructor
     * @prop {Panorama~RequiredParameter} RequiredParameter Required parameters: "panoramaCode" and "imgPathMask" both or "sideTextures"
     * @prop {Panorama~RequiredSideTexture} RequiredSideTexture No side texture
     * @prop {Panorama~NoContainer} NoContainer Attempt to create instance of Panorama without container
     * @prop {Panorama~ContainerZeroSize} ContainerZeroSize jQuery object of container has no DOM-elements
     * @prop {Panorama~SinglePanoramaPerContainer} SinglePanoramaPerContainer Attempt to create more than one panoramas in same container
     * @prop {Panorama~HandlerCannotFoundThePanorama} HandlerCannotFoundThePanorama Panorama removed but handler still triggers
     * @static
     */
    Panorama.exceptions = {};

    // Helper for new exception
    function baseException() {
        this.constructor.prototype.__proto__ = Error.prototype;
        Error.call(this);
        this.name = this.constructor.name;
    }

    /** @typedef {Error} Panorama~IncorrectArgument */
    Panorama.exceptions.IncorrectArgument
    = function IncorrectArgument(message) {
        baseException.call(this);
        this.message = message || 'Incorrect argument of constructor';
    };

    /** @typedef {Error} Panorama~RequiredParameter */
    Panorama.exceptions.RequiredParameter
    = function RequiredParameter(message) {
        baseException.call(this);
        this.message = message || 'Required parameters: "panoramaCode" and "imgPathMask" both or "sideTextures"';
    };

    /** @typedef {Error} Panorama~RequiredSideTexture */
    Panorama.exceptions.RequiredSideTexture
    = function RequiredSideTexture(message) {
        baseException.call(this);
        this.message = message || 'No side texture';
    };

    /** @typedef {Error} Panorama~NoContainer */
    Panorama.exceptions.NoContainer
    = function NoContainer(message) {
        baseException.call(this);
        this.message = message || 'Attempt to create instance of Panorama without container';
    };

    /** @typedef {Error} Panorama~ContainerZeroSize */
    Panorama.exceptions.ContainerZeroSize
    = function ContainerZeroSize(message) {
        baseException.call(this);
        this.message = message || 'jQuery object of container has no DOM-elements';
    };

    /** @typedef {Error} Panorama~SinglePanoramaPerContainer */
    Panorama.exceptions.SinglePanoramaPerContainer
    = function SinglePanoramaPerContainer(message) {
        baseException.call(this);
        this.message = message || 'Attempt to create more than one panoramas in same container';
    };

    /** @typedef {Error} Panorama~HandlerCannotFoundThePanorama */
    Panorama.exceptions.HandlerCannotFoundThePanorama
    = function HandlerCannotFoundThePanorama(message) {
        baseException.call(this);
        this.message = message || 'Panorama removed but handler still triggers';
    };

    // Provide exceptions to instance of constructor too
    Panorama.prototype.exceptions = Panorama.exceptions;

    /**
     * Panorama handlers
     *
     * @memberOf Panorama
     * @public
     * @type {Object.<function>}
     * @prop {Panorama~resizeHandler} resizeHandler
     * @prop {function} mouseDownHandler
     * @prop {function} mouseMoveHandler
     * @prop {function} mouseUpHandler
     * @prop {function} mouseWheelHandler
     * @prop {function} touchStartHandler
     * @prop {function} touchMoveHandler
     * @prop {function} touchEndHandler
     * @static
     */
    Panorama.handlers = {};

    /**
     * @callback Panorama~resizeHandler
     * @param {Panorama} panorama Instance of Panorama
     */
    Panorama.handlers.resizeHandler
    = function resizeHandler(panorama) {
        panorama._camera.aspect =
            panorama.$container.width() / panorama.$container.height();
        panorama._camera.updateProjectionMatrix();

        panorama._renderer.setSize(
            panorama.$container.width(), panorama.$container.height()
        );
    };

    // Handler helper to get panorama by container (this)
    function getPanorama() {
        var panorama = $(this).data('panorama');
        if (!panorama)
            throw new Panorama.exceptions.HandlerCannotFoundThePanorama();

        return panorama;
    }

    Panorama.handlers.mouseDownHandler
    = function mouseDownHandler(event) {
        var panorama = getPanorama.call(this);

        panorama._holdByUser = true;
        panorama._mouseDownState = {
            clientX: event.clientX,
            clientY: event.clientY,
            lon: panorama._lon,
            lat: panorama._lat
        };

        return false;
    };

    Panorama.handlers.mouseMoveHandler
    = function mouseMoveHandler(event) {
        var panorama = getPanorama.call(this);

        if (panorama._holdByUser === true && panorama._mouseDownState) {
            panorama._lon =
                (panorama._mouseDownState.clientX - event.clientX)
                * 0.1 + panorama._mouseDownState.lon;
            panorama._lat =
                (event.clientY - panorama._mouseDownState.clientY)
                * 0.1 + panorama._mouseDownState.lat;
        }

        return false;
    };

    Panorama.handlers.mouseUpHandler
    = function mouseUpHandler(event) {
        var panorama = getPanorama.call(this);

        delete panorama._mouseDownState;
        panorama._holdByUser = false;

        return false;
    };

    Panorama.handlers.mouseWheelHandler
    = function mouseWheelHandler(event) {
        var panorama = getPanorama.call(this);

        if (event.deltaY == 1) {
            if (panorama._camera.fov - panorama._params.fovMouseStep
            < panorama._params.minFov) return false;

            panorama._camera.fov -= panorama._params.fovMouseStep;
            panorama._camera.updateProjectionMatrix();
        } else if (event.deltaY == -1) {
            if (panorama._camera.fov + panorama._params.fovMouseStep
            > panorama._params.maxFov) return false;

            panorama._camera.fov += panorama._params.fovMouseStep;
            panorama._camera.updateProjectionMatrix();
        }

        return false;
    };

    Panorama.handlers.touchStartHandler
    = function touchStartHandler(event) {
        var panorama = getPanorama.call(this);

        panorama._holdByUser = true;
        if (event.touches.length == 1) {
            panorama._touchStartState = {
                pageX: event.touches[0].pageX,
                pageY: event.touches[0].pageY,
                lon: panorama._lon,
                lat: panorama._lat
            };
        }

        return false;
    };

    Panorama.handlers.touchMoveHandler
    = function touchMoveHandler(event) {
        var panorama = getPanorama.call(this);

        if (panorama._holdByUser && event.touches.length == 1
        && panorama._touchStartState) {
            panorama._lon =
                (panorama._touchStartState.pageX - event.touches[0].pageX)
                * 0.1 + panorama._touchStartState.lon;
            panorama._lat =
                (event.touches[0].pageY - panorama._touchStartState.pageY)
                * 0.1 + panorama._touchStartState.lat;
        }

        return false;
    };

    Panorama.handlers.touchEndHandler
    = function touchEndHandler(event) {
        var panorama = getPanorama.call(this);

        delete panorama._touchStartState;
        panorama._holdByUser = false;

        return false;
    };

    // Provide handlers to instance of constructor too
    Panorama.prototype.handlers = Panorama.handlers;

    return Panorama;

});
