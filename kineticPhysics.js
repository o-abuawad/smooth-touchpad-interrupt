// SPDX-License-Identifier: GPL-2.0-or-later
// Kinetic Physics and Velocity Continuity for SwipeTracker

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MIN_ANIMATION_DURATION = 140;
const MAX_ANIMATION_DURATION = 420;
const DURATION_MULTIPLIER = 3;
const STATIONARY_VELOCITY_THRESHOLD = 0.03;

/**
 * Patches SwipeTracker with kinetic physics to ensure zero-discontinuity
 * velocity hand-off when lifting fingers and during animation interruptions.
 *
 * @param {object} injectionManager - Extension injection manager
 * @param {object} SwipeTrackerProto - Prototype of SwipeTracker
 * @param {Gio.Settings} settings - Extension settings
 */
export function patchSwipeTrackerPhysics(injectionManager, SwipeTrackerProto, settings) {
    injectionManager.overrideMethod(
        SwipeTrackerProto,
        '_endGesture',
        originalMethod => function (velocity, distance, isTouchpad) {
            if (this._state !== 1 /* State.SCROLLING */)
                return;

            if ((this._allowedModes & Main.actionMode) === 0 || !this.enabled) {
                this._interrupt();
                return;
            }

            const velocityMatching = settings ? settings.get_boolean('velocity-matching') : true;

            if (!velocityMatching || !isTouchpad) {
                this._isRestRelease = false;
                return originalMethod.call(this, velocity, distance, isTouchpad);
            }

            const endProgress = this._getEndProgress(velocity, distance, isTouchpad);
            const deltaProgress = endProgress - this._progress;
            const normalizedVelocity = velocity / distance;
            const absVelocity = Math.abs(normalizedVelocity);
            const nPoints = Math.max(1, Math.ceil(Math.abs(deltaProgress)));
            const maxDuration = MAX_ANIMATION_DURATION * Math.log2(1 + nPoints);

            // Case 1: Stationary release (fingers held still or near-zero velocity before lifting)
            if (absVelocity < STATIONARY_VELOCITY_THRESHOLD) {
                this._isRestRelease = true;
                let duration = Math.round(220 * Math.sqrt(Math.abs(deltaProgress)) + 80);
                duration = Math.clamp(duration, MIN_ANIMATION_DURATION, maxDuration);

                this._reset();
                this.emit('end', duration, endProgress);
                return;
            }

            // Case 2: Reversed flick or movement opposing the snap point
            if (deltaProgress * normalizedVelocity <= 0) {
                this._isRestRelease = true;
                let duration = Math.round(250 * Math.sqrt(Math.abs(deltaProgress)) + 60);
                duration = Math.clamp(duration, MIN_ANIMATION_DURATION, maxDuration);

                this._reset();
                this.emit('end', duration, endProgress);
                return;
            }

            // Case 3: In-direction flick with kinetic momentum
            // For EASE_OUT_CUBIC, initial derivative is 3 * deltaP / T.
            // Matching initial animation speed to finger speed requires T = 3 * deltaP / velocity.
            this._isRestRelease = false;
            let duration = Math.round(Math.abs(deltaProgress) / absVelocity * DURATION_MULTIPLIER);
            duration = Math.clamp(duration, MIN_ANIMATION_DURATION, maxDuration);

            this._reset();
            this.emit('end', duration, endProgress);
        }
    );
}
