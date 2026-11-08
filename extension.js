// SPDX-License-Identifier: GPL-2.0-or-later
// Smooth Touchpad Animation Interruption Extension for GNOME 51+

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SwipeTracker from 'resource:///org/gnome/shell/ui/swipeTracker.js';
import * as Overview from 'resource:///org/gnome/shell/ui/overview.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
import * as WorkspacesView from 'resource:///org/gnome/shell/ui/workspacesView.js';
import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';

import {handleInterceptedTouchpadEvent} from './touchpadInterrupter.js';
import {patchWorkspaceAnimationController} from './workspaceAnimationPatch.js';
import {patchOverviewAndWorkspaces} from './overviewPatch.js';
import {patchSwipeTrackerPhysics} from './kineticPhysics.js';

export default class SmoothTouchpadInterruptExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._injectionManager = new InjectionManager();
        this._hookedGestures = [];

        // 1. Patch SwipeTracker kinetic physics
        patchSwipeTrackerPhysics(
            this._injectionManager,
            SwipeTracker.SwipeTracker.prototype,
            this._settings
        );

        // Ensure newly created swipe trackers assign tracker reference to their touchpad gesture
        this._injectionManager.overrideMethod(
            SwipeTracker.SwipeTracker.prototype,
            '_init',
            originalMethod => function (actor, orientation, allowedModes, params) {
                originalMethod.call(this, actor, orientation, allowedModes, params);
                if (this._touchpadGesture)
                    this._touchpadGesture._tracker = this;
            }
        );

        // 2. Patch TouchpadSwipeGesture prototype for all future instances
        const wsAnimTracker = Main.wm?._workspaceAnimation?._swipeTracker;
        const TouchpadSwipeGestureClass = wsAnimTracker?._touchpadGesture?.constructor;
        if (TouchpadSwipeGestureClass) {
            const TouchpadProto = TouchpadSwipeGestureClass.prototype;
            const settings = this._settings;

            this._injectionManager.overrideMethod(
                TouchpadProto,
                '_handleEvent',
                originalMethod => function (actor, event) {
                    return handleInterceptedTouchpadEvent(
                        this, actor, event, originalMethod.bind(this), settings
                    );
                }
            );
        }

        // 3. Patch WorkspaceAnimationController
        patchWorkspaceAnimationController(
            this._injectionManager,
            WorkspaceAnimation.WorkspaceAnimationController.prototype,
            this._settings
        );

        // 4. Patch Overview & WorkspacesView
        patchOverviewAndWorkspaces(
            this._injectionManager,
            Overview.Overview.prototype,
            OverviewControls.ControlsManager.prototype,
            WorkspacesView.WorkspacesDisplay.prototype,
            WorkspacesView.WorkspacesView.prototype,
            this._settings
        );

        // 5. Hook all existing SwipeTracker gestures in the running shell
        const knownTrackers = this._getKnownTrackers();
        for (const tracker of knownTrackers)
            this._hookExistingGesture(tracker);

        // 6. Manage allow-long-swipes on workspace animation tracker
        this._settingsChangedId = this._settings.connect('changed::allow-long-swipes', () => {
            this._updateAllowLongSwipes();
        });
        this._updateAllowLongSwipes();
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            delete this._settingsChangedId;
        }

        // Restore allowLongSwipes to GNOME default (false)
        if (Main.wm?._workspaceAnimation?._swipeTracker)
            Main.wm._workspaceAnimation._swipeTracker.allowLongSwipes = false;

        // Unhook existing gestures and reconnect original handlers
        this._unhookAllGestures();

        // Restore all prototype methods
        if (this._injectionManager) {
            this._injectionManager.clear();
            delete this._injectionManager;
        }

        delete this._settings;
    }

    _getKnownTrackers() {
        const trackers = [];
        if (Main.wm?._workspaceAnimation?._swipeTracker)
            trackers.push(Main.wm._workspaceAnimation._swipeTracker);

        if (Main.overview?._swipeTracker)
            trackers.push(Main.overview._swipeTracker);

        const controls = Main.overview?._overview?.controls;
        if (controls?._workspacesDisplay?._swipeTracker)
            trackers.push(controls._workspacesDisplay._swipeTracker);

        if (controls?._appDisplay?._swipeTracker)
            trackers.push(controls._appDisplay._swipeTracker);

        if (Main.screenShield?._dialog?._swipeTracker)
            trackers.push(Main.screenShield._dialog._swipeTracker);

        return trackers;
    }

    _hookExistingGesture(tracker) {
        const gesture = tracker?._touchpadGesture;
        if (!gesture || gesture._hookedBySmoothTouchpad)
            return;

        gesture._tracker = tracker;
        const actor = tracker._panGesture?.actor ||
            tracker._actor ||
            (tracker === Main.wm?._workspaceAnimation?._swipeTracker
                ? global.stage
                : Main.layoutManager.overviewGroup);
        if (!actor)
            return;

        gesture._hookedActor = actor;
        gesture._hookedBySmoothTouchpad = true;

        // Disconnect the original bound handler
        actor.disconnectObject(gesture);

        // Connect our intercepted handler
        const self = this;
        const boundHandler = function (actorArg, event) {
            return handleInterceptedTouchpadEvent(
                gesture, actorArg, event, gesture._handleEvent.bind(gesture), self._settings
            );
        };
        gesture._boundSmoothHandler = boundHandler;

        actor.connectObject('event::touchpad', boundHandler, gesture);
        this._hookedGestures.push(gesture);
    }

    _unhookAllGestures() {
        for (const gesture of this._hookedGestures) {
            if (gesture._hookedActor && gesture._boundSmoothHandler) {
                gesture._hookedActor.disconnectObject(gesture);
                // Reconnect original handler
                gesture._hookedActor.connectObject(
                    'event::touchpad',
                    gesture._handleEvent.bind(gesture),
                    gesture
                );
            }
            delete gesture._hookedActor;
            delete gesture._boundSmoothHandler;
            delete gesture._hookedBySmoothTouchpad;
        }
        this._hookedGestures = [];
    }

    _updateAllowLongSwipes() {
        const enabled = this._settings.get_boolean('allow-long-swipes');
        if (Main.wm?._workspaceAnimation?._swipeTracker)
            Main.wm._workspaceAnimation._swipeTracker.allowLongSwipes = enabled;
    }
}
