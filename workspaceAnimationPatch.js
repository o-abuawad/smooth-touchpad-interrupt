// SPDX-License-Identifier: GPL-2.0-or-later
// Workspace Animation Controller Patch for Smooth Interruption

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WINDOW_ANIMATION_TIME} from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';

/**
 * Applies patches to WorkspaceAnimationController for fluid interruption,
 * multi-workspace continuous swiping, and keyboard switch catching.
 *
 * @param {object} injectionManager - Extension injection manager
 * @param {object} WorkspaceAnimationControllerProto - Prototype of WorkspaceAnimationController
 * @param {Gio.Settings} settings - Extension settings
 */
export function patchWorkspaceAnimationController(injectionManager, WorkspaceAnimationControllerProto, settings) {
    // 1. _switchWorkspaceBegin
    injectionManager.overrideMethod(
        WorkspaceAnimationControllerProto,
        '_switchWorkspaceBegin',
        originalMethod => function (tracker, monitor) {
            if (Meta.prefs_get_workspaces_only_on_primary() &&
                monitor !== Main.layoutManager.primaryIndex)
                return;

            const workspaceManager = global.workspace_manager;
            const horiz = workspaceManager.layout_rows !== -1;
            tracker.orientation = horiz
                ? Clutter.Orientation.HORIZONTAL
                : Clutter.Orientation.VERTICAL;

            let prevTargetProgress = null;
            if (this._switchData?.baseMonitorGroup) {
                const prevTransition = this._switchData.baseMonitorGroup.get_transition?.('progress');
                if (prevTransition)
                    prevTargetProgress = prevTransition.get_interval().peek_final_value();
            }

            // If an animation is already in flight (touchpad or keyboard initiated):
            if (this._switchData) {
                // Pause and clear all running transitions on all monitor groups
                for (const group of this._switchData.monitors || [])
                    group.remove_all_transitions();

                // Gesture is now actively driving the motion
                this._switchData.gestureActivated = false;
                this._switchData.inProgress = false;
            } else {
                this._prepareWorkspaceSwitch();
            }

            let monitorGroup = this._findMonitorGroup(monitor);
            if (!monitorGroup && this._switchData?.monitors?.length > 0)
                monitorGroup = this._switchData.monitors[0];

            if (!monitorGroup) {
                this._prepareWorkspaceSwitch();
                monitorGroup = this._findMonitorGroup(monitor) || this._switchData?.monitors?.[0];
            }

            if (!monitorGroup)
                return;

            const baseDistance = monitorGroup.baseDistance;
            const progress = monitorGroup.progress;

            let cancelProgress;
            if (prevTargetProgress !== null) {
                cancelProgress = prevTargetProgress;
            } else {
                const closestWs = monitorGroup.findClosestWorkspace(progress);
                cancelProgress = monitorGroup.getWorkspaceProgress(closestWs);
            }

            const points = monitorGroup.getSnapPoints();
            this._switchData.baseMonitorGroup = monitorGroup;

            tracker.confirmSwipe(baseDistance, points, progress, cancelProgress);
        }
    );

    // 2. _switchWorkspaceEnd
    injectionManager.overrideMethod(
        WorkspaceAnimationControllerProto,
        '_switchWorkspaceEnd',
        originalMethod => function (tracker, duration, endProgress) {
            if (!this._switchData || !this._switchData.baseMonitorGroup)
                return;

            const switchData = this._switchData;
            switchData.gestureActivated = true;
            tracker._animating = true;

            const newWs = switchData.baseMonitorGroup.findClosestWorkspace(endProgress);
            const endTime = Clutter.get_current_event_time();

            const gentleRest = settings ? settings.get_boolean('gentle-rest-release') : true;
            const mode = (gentleRest && tracker._isRestRelease)
                ? Clutter.AnimationMode.EASE_IN_OUT_CUBIC
                : Clutter.AnimationMode.EASE_OUT_CUBIC;

            for (const monitorGroup of this._switchData.monitors) {
                const progress = monitorGroup.getWorkspaceProgress(newWs);

                const params = {
                    duration: Math.max(160, Math.min(320, duration || WINDOW_ANIMATION_TIME)),
                    mode,
                };

                if (monitorGroup.index === Main.layoutManager.primaryIndex) {
                    params.onComplete = () => {
                        tracker._animating = false;
                        if (!newWs.active)
                            newWs.activate(endTime);
                        this._finishWorkspaceSwitch(switchData);
                    };
                }

                monitorGroup.ease_property('progress', progress, params);
            }
        }
    );

    // 3. animateSwitch: support touchpad mid-interruption during keyboard/dock switches
    injectionManager.overrideMethod(
        WorkspaceAnimationControllerProto,
        'animateSwitch',
        originalMethod => function (from, to, direction, onComplete) {
            const catchKeyboard = settings ? settings.get_boolean('catch-keyboard-switches') : true;
            if (!catchKeyboard)
                return originalMethod.call(this, from, to, direction, onComplete);

            // Keep swipe tracker enabled so touchpad can catch mid-flight!
            this._swipeTracker.enabled = true;
            this._swipeTracker._animating = true;

            const alreadyRunning = !!this._switchData;
            if (!alreadyRunning) {
                this._prepareWorkspaceSwitch();
            }
            this._switchData.inProgress = true;

            const fromWs = global.workspace_manager.get_workspace_by_index(from);
            const toWs = global.workspace_manager.get_workspace_by_index(to);

            let isReversal = false;
            let deltaP = 1.0;
            if (this._switchData?.baseMonitorGroup && toWs) {
                const curP = this._switchData.baseMonitorGroup.progress;
                const targetP = this._switchData.baseMonitorGroup.getWorkspaceProgress(toWs);
                deltaP = Math.abs(targetP - curP);
                if (alreadyRunning) {
                    const prevTransition = this._switchData.baseMonitorGroup.get_transition?.('progress');
                    if (prevTransition) {
                        const prevTarget = prevTransition.get_interval().peek_final_value();
                        isReversal = ((prevTarget - curP) * (targetP - curP)) < 0;
                    }
                }
            }

            const mode = isReversal
                ? Clutter.AnimationMode.EASE_IN_OUT_CUBIC
                : Clutter.AnimationMode.EASE_OUT_CUBIC;

            const duration = Math.clamp(
                Math.round(WINDOW_ANIMATION_TIME * Math.sqrt(deltaP)),
                160,
                320
            );

            for (const monitorGroup of this._switchData.monitors) {
                if (!alreadyRunning)
                    monitorGroup.progress = monitorGroup.getWorkspaceProgress(fromWs);

                const progress = monitorGroup.getWorkspaceProgress(toWs);

                const params = {
                    duration,
                    mode,
                };

                if (monitorGroup.index === Main.layoutManager.primaryIndex) {
                    params.onComplete = () => {
                        this._swipeTracker._animating = false;
                        if (this._switchData && !this._switchData.gestureActivated) {
                            this._finishWorkspaceSwitch(this._switchData);
                            if (onComplete)
                                onComplete();
                        }
                    };
                }

                monitorGroup.ease_property('progress', progress, params);
            }
        }
    );
}
