// SPDX-License-Identifier: GPL-2.0-or-later
// Touchpad Gesture Interruption Handler for GNOME Shell

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const TouchpadState = {
    NONE: 0,
    PENDING: 1,
    HANDLING: 2,
    IGNORED: 3,
};

export const GESTURE_FINGER_COUNT = 3;
export const DRAG_THRESHOLD_DISTANCE = 16;
export const DEFAULT_FLICK_THRESHOLD = 8;
export const DEFAULT_FLICK_WINDOW = 350; // ms
export const DEFAULT_HOLD_DRAG_THRESHOLD = 20; // px
export const HOLD_DRAG_MIN_DURATION = 140; // ms
export const ROLLING_WINDOW_MS = 180; // ms
export const TOUCHPAD_BASE_HEIGHT = 300;
export const TOUCHPAD_BASE_WIDTH = 400;

/**
 * Checks whether an animation is actively running on the shell or on the given tracker.
 *
 * @param {object} tracker - the parent SwipeTracker instance if available
 * @returns {boolean} true if an animation is currently mid-flight
 */
export function isAnimationActive(tracker) {
    if (tracker?._animating)
        return true;

    const wsAnim = Main.wm?._workspaceAnimation;
    if (wsAnim?._switchData) {
        if (wsAnim._switchData.gestureActivated || wsAnim._switchData.inProgress)
            return true;
        for (const m of wsAnim._switchData.monitors || []) {
            if (m?.get_transition?.('progress') !== null)
                return true;
        }
    }

    if (Main.overview?._animationInProgress)
        return true;

    const controls = Main.overview?._overview?.controls;
    if (controls?._stateAdjustment?.get_transition?.('value') !== null)
        return true;

    const wsDisplay = controls?._workspacesDisplay;
    if (wsDisplay?._scrollAdjustment?.get_transition?.('value') !== null)
        return true;

    const shownState = Main.overview?._shownState;
    if (shownState === 'SHOWING' || shownState === 'HIDING')
        return true;

    return false;
}

/**
 * Performs a smooth workspace transition to the neighbor workspace
 * matching the flick direction, exactly like Super + Alt / Super + PageUp/Down.
 *
 * @param {object} gesture - TouchpadSwipeGesture instance
 * @param {number} primaryDelta - Directional distance of the flick
 * @returns {boolean} true if a workspace switch was initiated
 */
function handleQuickFlick(gesture, primaryDelta) {
    const workspaceManager = global.workspace_manager;
    const isVerticalWorkspaces = workspaceManager.layout_rows === -1;
    const gestureIsHoriz = gesture.orientation === Clutter.Orientation.HORIZONTAL;
    const matchWorkspaceOrientation = isVerticalWorkspaces ? !gestureIsHoriz : gestureIsHoriz;

    if (!matchWorkspaceOrientation)
        return false;

    let direction;
    if (isVerticalWorkspaces) {
        direction = primaryDelta > 0
            ? Meta.MotionDirection.DOWN
            : Meta.MotionDirection.UP;
    } else {
        const isRtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        if (primaryDelta > 0)
            direction = isRtl ? Meta.MotionDirection.LEFT : Meta.MotionDirection.RIGHT;
        else
            direction = isRtl ? Meta.MotionDirection.RIGHT : Meta.MotionDirection.LEFT;
    }

    const activeWs = workspaceManager.get_active_workspace();
    const targetWs = activeWs.get_neighbor(direction);

    if (targetWs && targetWs !== activeWs) {
        Main.wm.actionMoveWorkspace(targetWs);
        return true;
    }

    return false;
}

/**
 * Intercepts touchpad swipe events to enable instant mid-animation interruption,
 * flick-retargeting with zero freeze/stutter, and seamless 1:1 interactive hold-drag.
 *
 * @param {object} gesture - TouchpadSwipeGesture instance
 * @param {Clutter.Actor} actor - Actor receiving events
 * @param {Clutter.Event} event - The touchpad swipe event
 * @param {Function} origHandleEvent - Original _handleEvent method
 * @param {Gio.Settings} settings - Extension settings
 * @returns {boolean} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
 */
export function handleInterceptedTouchpadEvent(gesture, actor, event, origHandleEvent, settings) {
    if (event.type() !== Clutter.EventType.TOUCHPAD_SWIPE)
        return Clutter.EVENT_PROPAGATE;

    const phase = event.get_gesture_phase();
    const fingerCount = event.get_touchpad_gesture_finger_count();

    if (fingerCount < GESTURE_FINGER_COUNT)
        return Clutter.EVENT_PROPAGATE;

    if ((gesture._allowedModes & Main.actionMode) === 0)
        return Clutter.EVENT_PROPAGATE;

    if (!gesture.enabled)
        return Clutter.EVENT_PROPAGATE;

    if (gesture._state === TouchpadState.IGNORED && phase !== Clutter.TouchpadGesturePhase.BEGIN)
        return Clutter.EVENT_PROPAGATE;

    const time = event.get_time();
    const [x, y] = event.get_coords();
    const [dx, dy] = event.get_gesture_motion_delta_unaccelerated();

    const naturalScroll = gesture._touchpadSettings?.get_boolean('natural-scroll') ?? false;
    const isVertical = gesture.orientation === Clutter.Orientation.VERTICAL;
    const baseDistance = isVertical ? TOUCHPAD_BASE_HEIGHT : TOUCHPAD_BASE_WIDTH;

    const flickThreshold = settings ? settings.get_int('flick-threshold') : DEFAULT_FLICK_THRESHOLD;
    const flickWindow = settings ? settings.get_int('flick-time-window') : DEFAULT_FLICK_WINDOW;
    const holdDragThreshold = settings ? settings.get_int('hold-drag-threshold') : DEFAULT_HOLD_DRAG_THRESHOLD;

    const isMidFlight = isAnimationActive(gesture._tracker);

    switch (phase) {
    case Clutter.TouchpadGesturePhase.BEGIN:
        gesture._swipeStartTime = time;
        gesture._swipeStartX = x;
        gesture._swipeStartY = y;
        gesture._cumulativeX = 0;
        gesture._cumulativeY = 0;
        gesture._motionHistory = [];
        gesture._wasMidFlight = isMidFlight;
        gesture._latchedToInteractive = false;
        gesture._state = TouchpadState.NONE;

        if (isMidFlight) {
            // Animation in flight: keep it gliding smoothly without halting velocity
            return Clutter.EVENT_STOP;
        }
        break;

    case Clutter.TouchpadGesturePhase.UPDATE: {
        gesture._cumulativeX += dx;
        gesture._cumulativeY += dy;

        // Maintain rolling motion history over the last ROLLING_WINDOW_MS
        if (!gesture._motionHistory)
            gesture._motionHistory = [];
        gesture._motionHistory.push({time, dx, dy});
        const cutoff = time - ROLLING_WINDOW_MS;
        while (gesture._motionHistory.length > 0 && gesture._motionHistory[0].time < cutoff)
            gesture._motionHistory.shift();

        const cdx = gesture._cumulativeX;
        const cdy = gesture._cumulativeY;
        let primaryDelta = isVertical ? cdy : cdx;
        if (naturalScroll)
            primaryDelta = -primaryDelta;
        const primaryDist = Math.abs(primaryDelta);
        const elapsed = time - (gesture._swipeStartTime || time);

        // Subcase 1: Mid-flight animation interruption
        if (gesture._wasMidFlight) {
            if (!gesture._latchedToInteractive) {
                // If fingers stay down and move deliberately past threshold, latch into 1:1 interactive drag
                if (elapsed >= HOLD_DRAG_MIN_DURATION && primaryDist >= holdDragThreshold) {
                    gesture._latchedToInteractive = true;
                    gesture._state = TouchpadState.HANDLING;
                    gesture.emit('begin', time, x, y);
                    gesture.emit('update', time, primaryDelta, baseDistance);
                    return Clutter.EVENT_STOP;
                }
                // Within the flick window: continue gliding smoothly
                return Clutter.EVENT_STOP;
            }

            // Already latched into interactive drag
            let stepDelta = isVertical ? dy : dx;
            if (naturalScroll)
                stepDelta = -stepDelta;
            gesture.emit('update', time, stepDelta, baseDistance);
            return Clutter.EVENT_STOP;
        }

        // Subcase 2: Gesture started from rest
        if (gesture._state === TouchpadState.NONE) {
            if (dx === 0 && dy === 0)
                return Clutter.EVENT_PROPAGATE;
            gesture._state = TouchpadState.PENDING;
        }

        if (gesture._state === TouchpadState.PENDING) {
            const distance = Math.sqrt(cdx * cdx + cdy * cdy);
            if (distance >= DRAG_THRESHOLD_DISTANCE) {
                const gestureOrientation = Math.abs(cdx) > Math.abs(cdy)
                    ? Clutter.Orientation.HORIZONTAL
                    : Clutter.Orientation.VERTICAL;

                if (gestureOrientation === gesture.orientation) {
                    gesture._state = TouchpadState.HANDLING;
                    gesture.emit('begin', time, x, y);
                    gesture.emit('update', time, primaryDelta, baseDistance);
                    return Clutter.EVENT_STOP;
                } else {
                    gesture._state = TouchpadState.IGNORED;
                    return Clutter.EVENT_PROPAGATE;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }

        if (gesture._state === TouchpadState.HANDLING) {
            let stepDelta = isVertical ? dy : dx;
            if (naturalScroll)
                stepDelta = -stepDelta;
            gesture.emit('update', time, stepDelta, baseDistance);
            return Clutter.EVENT_STOP;
        }
        break;
    }

    case Clutter.TouchpadGesturePhase.END:
    case Clutter.TouchpadGesturePhase.CANCEL: {
        const wasLatched = gesture._latchedToInteractive;
        const wasHandling = gesture._state === TouchpadState.HANDLING;
        const elapsed = time - (gesture._swipeStartTime || time);

        // Compute rolling window delta over the last ROLLING_WINDOW_MS
        const history = gesture._motionHistory || [];
        const cutoff = time - ROLLING_WINDOW_MS;
        const recentEvents = history.filter(h => h.time >= cutoff);
        const recentX = recentEvents.reduce((acc, h) => acc + h.dx, 0);
        const recentY = recentEvents.reduce((acc, h) => acc + h.dy, 0);
        let recentDelta = isVertical ? recentY : recentX;
        if (naturalScroll)
            recentDelta = -recentDelta;
        const recentDist = Math.abs(recentDelta);

        let totalDelta = isVertical ? gesture._cumulativeY : gesture._cumulativeX;
        if (naturalScroll)
            totalDelta = -totalDelta;
        const totalDist = Math.abs(totalDelta);

        // Reset tracking state
        gesture._state = TouchpadState.NONE;
        gesture._latchedToInteractive = false;
        gesture._wasMidFlight = false;
        gesture._motionHistory = [];

        // 1. If actively driving an interactive 1:1 drag, emit 'end' normally
        if (wasLatched || wasHandling) {
            gesture.emit('end', time, baseDistance);
            return Clutter.EVENT_STOP;
        }

        // 2. Otherwise, check if this qualifies as a quick flick
        // Recognized if either:
        // a) Rolling window distance in the last 180ms >= flickThreshold (even if fingers rested before flicking)
        // b) Total gesture distance >= flickThreshold within flickWindow
        if (phase === Clutter.TouchpadGesturePhase.END) {
            const isRollingFlick = recentDist >= flickThreshold;
            const isTotalFlick = totalDist >= flickThreshold && elapsed <= flickWindow;

            if (isRollingFlick || isTotalFlick) {
                const flickDelta = isRollingFlick ? recentDelta : totalDelta;
                if (handleQuickFlick(gesture, flickDelta))
                    return Clutter.EVENT_STOP;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }
    }

    return Clutter.EVENT_PROPAGATE;
}
