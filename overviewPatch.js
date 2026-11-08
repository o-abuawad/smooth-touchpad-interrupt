// SPDX-License-Identifier: GPL-2.0-or-later
// Overview and WorkspacesView Interruption Patch for Continuous Fluid Motion

import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';

const WORKSPACE_SWITCH_TIME = 250;

/**
 * Applies patches to Overview, OverviewControls, and WorkspacesView
 * to eliminate animation cut-offs, fighting transitions, and stutter.
 *
 * @param {object} injectionManager - Extension injection manager
 * @param {object} OverviewProto - Prototype of Overview
 * @param {object} ControlsManagerProto - Prototype of ControlsManager
 * @param {object} WorkspacesDisplayProto - Prototype of WorkspacesDisplay
 * @param {object} WorkspacesViewProto - Prototype of WorkspacesView
 * @param {Gio.Settings} settings - Extension settings
 */
export function patchOverviewAndWorkspaces(
    injectionManager,
    OverviewProto,
    ControlsManagerProto,
    WorkspacesDisplayProto,
    WorkspacesViewProto,
    settings
) {
    // 1. Fix WorkspacesView: Eliminate destructive _scrollToActive() and guard visibility pruning during eases
    if (WorkspacesViewProto) {
        injectionManager.overrideMethod(
            WorkspacesViewProto,
            'endTouchGesture',
            originalMethod => function () {
                this._gestureActive = false;
                this._updateVisibility();
                // CRITICAL FIX: DO NOT call this._scrollToActive()!
                // Stock GNOME calls _scrollToActive() here, which starts a redundant 250ms ease
                // to the already-active workspace. When the user swipes again, this phantom ease
                // fights the touchpad gesture at 120Hz, causing violent jitter and stutter.
            }
        );

        injectionManager.overrideMethod(
            WorkspacesViewProto,
            '_updateVisibility',
            originalMethod => function () {
                const workspaceManager = global.workspace_manager;
                const active = workspaceManager.get_active_workspace_index();

                const fitMode = this._fitModeAdjustment.value;
                const singleFitMode = fitMode === OverviewControls.FitMode?.SINGLE ?? false;
                // Guard: keep all traversed workspaces visible while scroll adjustment is easing
                const isScrolling = this._scrollAdjustment?.get_transition?.('value') !== null;

                for (let w = 0; w < this._workspaces.length; w++) {
                    const workspace = this._workspaces[w];

                    if (this._animating || this._gestureActive || isScrolling || !singleFitMode)
                        workspace.show();
                    else
                        workspace.visible = Math.abs(w - active) <= 1;
                }
            }
        );

        injectionManager.overrideMethod(
            WorkspacesViewProto,
            '_activeWorkspaceChanged',
            originalMethod => function (_wm, _from, _to, _direction) {
                const adj = this._scrollAdjustment;
                const active = global.workspace_manager.get_active_workspace_index();

                // If already at active workspace, simply update visibility
                if (Math.abs(adj.value - active) < 0.001) {
                    this._updateVisibility();
                    this._raiseActiveWorkspace();
                    return;
                }

                // Only scroll if not currently in a gesture
                if (!this._gestureActive) {
                    this._scrollToActive();
                    this._raiseActiveWorkspace();
                }
            }
        );
    }

    // 2. Fix WorkspacesDisplay: Retargeting, cancel preservation, and gentle rest harmonization
    if (WorkspacesDisplayProto) {
        injectionManager.overrideMethod(
            WorkspacesDisplayProto,
            '_activeWorkspaceChanged',
            originalMethod => function (_wm, _from, to, _direction) {
                const currentVal = this._scrollAdjustment.value;
                const deltaP = Math.abs(to - currentVal);
                if (deltaP < 0.001)
                    return;

                const transition = this._scrollAdjustment.get_transition('value');
                let isReversal = false;
                if (transition) {
                    const prevTarget = transition.get_interval().peek_final_value();
                    const prevDir = prevTarget - currentVal;
                    const newDir = to - currentVal;
                    isReversal = (prevDir * newDir) < 0;
                }

                // Reversals start with zero velocity to eliminate instantaneous acceleration impulse
                const mode = isReversal
                    ? Clutter.AnimationMode.EASE_IN_OUT_CUBIC
                    : Clutter.AnimationMode.EASE_OUT_CUBIC;

                // Square-root distance duration scaling maintains consistent visual pace
                const duration = Math.clamp(
                    Math.round(WORKSPACE_SWITCH_TIME * Math.sqrt(deltaP)),
                    160,
                    320
                );

                this._scrollAdjustment.ease(to, {
                    mode,
                    duration,
                });
            }
        );

        // In _switchWorkspaceBegin: do not kill in-flight transition and preserve cancel destination
        injectionManager.overrideMethod(
            WorkspacesDisplayProto,
            '_switchWorkspaceBegin',
            originalMethod => function (tracker, monitor) {
                if (this._workspacesOnlyOnPrimary && monitor !== this._primaryIndex)
                    return;

                const workspaceManager = global.workspace_manager;
                const adjustment = this._scrollAdjustment;

                const distance = global.workspace_manager.layout_rows === -1
                    ? this.height : this.width;

                for (let i = 0; i < this._workspacesViews.length; i++)
                    this._workspacesViews[i].startTouchGesture();

                const progress = adjustment.value / adjustment.page_size;
                const points = Array.from(
                    {length: workspaceManager.n_workspaces}, (v, i) => i);

                const transition = adjustment.get_transition('value');
                const cancelProgress = transition
                    ? transition.get_interval().peek_final_value()
                    : Math.round(progress);

                tracker.confirmSwipe(distance, points, progress, cancelProgress);

                this._gestureActive = true;
            }
        );

        // In _switchWorkspaceUpdate: remove transition once active finger updates begin driving
        injectionManager.overrideMethod(
            WorkspacesDisplayProto,
            '_switchWorkspaceUpdate',
            originalMethod => function (tracker, progress) {
                const adjustment = this._scrollAdjustment;
                if (adjustment.get_transition('value') !== null)
                    adjustment.remove_transition('value');
                adjustment.value = progress * adjustment.page_size;
            }
        );

        // In _switchWorkspaceEnd: immediate sync and rest-release harmonization
        injectionManager.overrideMethod(
            WorkspacesDisplayProto,
            '_switchWorkspaceEnd',
            originalMethod => function (tracker, duration, endProgress) {
                const workspaceManager = global.workspace_manager;
                const newWs = workspaceManager.get_workspace_by_index(endProgress);

                // Activate immediately so window titles, captions, and Mutter state are in sync
                if (newWs && !newWs.active)
                    newWs.activate(global.get_current_time());

                const gentleRest = settings ? settings.get_boolean('gentle-rest-release') : true;
                const mode = (gentleRest && tracker?._isRestRelease)
                    ? Clutter.AnimationMode.EASE_IN_OUT_CUBIC
                    : Clutter.AnimationMode.EASE_OUT_CUBIC;

                const easeDuration = Math.max(160, Math.min(320, duration || WORKSPACE_SWITCH_TIME));

                this._scrollAdjustment.ease(endProgress, {
                    mode,
                    duration: easeDuration,
                    onComplete: () => {
                        this._endTouchGesture();
                    },
                });
            }
        );
    }

    // 3. ControlsManager.prototype.gestureEnd
    if (ControlsManagerProto) {
        injectionManager.overrideMethod(
            ControlsManagerProto,
            'gestureEnd',
            originalMethod => function (target, duration, onComplete) {
                if (target === OverviewControls.ControlsState.HIDDEN)
                    this.prepareToLeaveOverview();

                this.dash.showAppsButton.checked =
                    target === OverviewControls.ControlsState.APP_GRID;

                const tracker = Main.overview?._swipeTracker;
                if (tracker)
                    tracker._animating = true;

                this._stateAdjustment.remove_transition('value');
                this._stateAdjustment.ease(target, {
                    duration: Math.max(160, Math.min(320, duration || 250)),
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => {
                        if (tracker)
                            tracker._animating = false;
                        if (onComplete)
                            onComplete();
                    },
                });

                this._stateAdjustment.gestureInProgress = false;
            }
        );
    }

    // 4. Overview.prototype safe transitions during rapid reversals
    if (OverviewProto) {
        injectionManager.overrideMethod(
            OverviewProto,
            '_gestureBegin',
            originalMethod => function (tracker) {
                Main.panel.style = null;
                if (this._overview?.controls)
                    this._overview.controls.gestureBegin(tracker);
            }
        );

        injectionManager.overrideMethod(
            OverviewProto,
            '_gestureUpdate',
            originalMethod => function (tracker, progress) {
                if (progress === 0)
                    return;

                if (!this._shown) {
                    this._shown = true;
                    this._visible = true;
                    this._visibleTarget = true;

                    Main.layoutManager.overviewGroup.set_child_above_sibling(
                        this._coverPane, null);
                    this._coverPane.show();

                    if (this._shownState !== 'SHOWING') {
                        try {
                            this._changeShownState('SHOWING');
                        } catch (e) {
                            // Suppress invalid state transition on rapid reversals
                        }
                    }

                    Main.layoutManager.showOverview();
                    this._syncGrab();

                    this._animationInProgress = true;
                }

                this._overview.controls.gestureProgress(progress);
            }
        );

        injectionManager.overrideMethod(
            OverviewProto,
            '_gestureEnd',
            originalMethod => function (tracker, duration, endProgress) {
                let onComplete;
                if (endProgress === 0) {
                    this._shown = false;
                    this._visibleTarget = false;
                    if (this._shownState !== 'HIDING') {
                        try {
                            this._changeShownState('HIDING');
                        } catch (e) {
                            // Suppress transition error if already hiding
                        }
                    }
                    Main.panel.style = `transition-duration: ${duration}ms;`;
                    onComplete = () => this._hideDone();
                } else {
                    onComplete = () => this._showDone();
                }

                this._overview.controls.gestureEnd(endProgress, duration, onComplete);
            }
        );
    }
}
