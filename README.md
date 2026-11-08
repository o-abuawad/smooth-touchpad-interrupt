# Smooth Touchpad Animation Interruption

A GNOME Shell extension that fixes stuttering, jitter, and abrupt cut-offs during rapid touchpad workspace switching and mid-flight animation interruptions.

Supported GNOME Shell versions: 48, 49, 50, 51+.

---

## The Problem

In stock GNOME Shell, rapid workspace switching using touchpad gestures (such as swiping quickly between workspaces in the Overview or on the desktop) suffers from visible stutter, freezing, and cut-offs. In contrast, performing the same rapid switching using keyboard shortcuts (`Super + Alt + Left/Right` or `Super + PageUp/Down`) animates continuously without interruption.

Analysis of GNOME Shell's internal JavaScript components (`workspacesView.js`, `workspaceAnimation.js`, and `swipeTracker.js`) revealed three primary causes in the stock implementation:

1. **Phantom Ease Transition Conflict**:
   In `workspacesView.js`, `WorkspacesView.prototype.endTouchGesture` unconditionally calls `this._scrollToActive()`. This initiates a redundant 250ms ease on `_scrollAdjustment` to the current workspace after `_gestureActive` has already been set to `false`. When a subsequent swipe begins during this 250ms window, the ongoing ease fights the incoming 120Hz touchpad deltas on every frame, resulting in visual jitter.

2. **Delayed Workspace Activation**:
   In `WorkspacesDisplay.prototype._switchWorkspaceEnd`, `newWs.activate()` is deferred until the `onComplete` callback of the ease transition. Until the transition completes, Mutter's active workspace state remains set to the old workspace. Additionally, `WorkspacesDisplay.prototype._activeWorkspaceChanged` contains an early exit (`if (this._gestureActive) return;`), which discards incoming workspace changes during gestures.

3. **Zero-Velocity Halting on Gesture Begin**:
   In `WorkspacesDisplay.prototype._switchWorkspaceBegin`, stock GNOME Shell removes active transitions (`adjustment.remove_transition('value')`) immediately upon gesture initiation. If an animation is in flight, placing fingers on the pad halts motion instantly. Because one workspace spans the full monitor width (e.g. 1920 pixels), initial finger travel moves the adjustment by only a fraction of a percent, causing the view to appear frozen.

4. **Desktop Swipe Tracker Lockout**:
   On the desktop (outside the Overview), `WorkspaceAnimationController.prototype.animateSwitch` sets `this._swipeTracker.enabled = false` during transitions, ignoring touchpad inputs entirely until the animation finishes.

---

## How It Works

This extension resolves these issues through targeted prototype overrides using GNOME's `InjectionManager`:

1. **Dual-Mode Gesture Handling (Flick Retargeting vs. 1:1 Hold-Drag)**:
   - **Quick Flicks**: When an animation is in flight and a directional flick is detected, the running ease is not terminated. Upon release, the extension invokes `Main.wm.actionMoveWorkspace(neighbor)` directly. Clutter's animation engine retargets the destination curve from the current in-flight value to the new workspace, matching the behavior of keyboard switching.
   - **Interactive Hold-Drag**: When fingers remain down for 140ms or more and exceed the hold-drag threshold, the gesture latches into 1:1 tracking starting from the current animated progress of `_scrollAdjustment`, providing seamless manual control without positional jumps.

2. **Removal of Redundant Easing**:
   Overrides `WorkspacesView.prototype.endTouchGesture` to remove the `_scrollToActive()` call, preventing rogue ease transitions from competing with subsequent touchpad input.

3. **Immediate Workspace State Synchronization**:
   Overrides `WorkspacesDisplay.prototype._switchWorkspaceEnd` to activate the target workspace immediately upon gesture completion, and removes the gesture lock from `_activeWorkspaceChanged` so Clutter can retarget mid-motion.

4. **Kinetic Deceleration & Rest Release**:
   Overrides `SwipeTracker.prototype._endGesture` to dynamically match the easing curve duration to instantaneous release velocity. When fingers are released while stationary, the animation uses `Clutter.AnimationMode.EASE_IN_OUT_CUBIC` to eliminate abrupt release kicks.

5. **Desktop Interruption Support**:
   Maintains `_swipeTracker.enabled = true` on the desktop so that touchpad gestures can catch and redirect animations initiated programmatically or by keyboard shortcuts.

---

## Installation

### Using Build Script

```bash
git clone https://github.com/o-abuawad/smooth-touchpad-interrupt.git
cd smooth-touchpad-interrupt
./build.sh
```

### Manual Installation

```bash
# Compile schemas
glib-compile-schemas schemas/

# Package the extension
gnome-extensions pack \
  --extra-source=touchpadInterrupter.js \
  --extra-source=workspaceAnimationPatch.js \
  --extra-source=overviewPatch.js \
  --extra-source=kineticPhysics.js \
  --force

# Copy to user extensions directory
UUID="smooth-touchpad-interrupt@osama.gemini"
mkdir -p ~/.local/share/gnome-shell/extensions/${UUID}
cp -r * ~/.local/share/gnome-shell/extensions/${UUID}/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/${UUID}/schemas/

# Enable the extension
gnome-extensions enable ${UUID}
```

On Wayland sessions, restart your session (log out and log back in) after first installation so GNOME Shell discovers the new extension directory.

---

## Configuration

Preferences can be modified via the GNOME Extensions application or through the command line:

```bash
gnome-extensions prefs smooth-touchpad-interrupt@osama.gemini
```

Available GSettings keys (`org.gnome.shell.extensions.smooth-touchpad-interrupt`):

| Key | Type | Default | Description |
|---|---|---|---|
| `instant-catch` | boolean | `true` | Catches running animations upon touch without waiting for the 16px threshold. |
| `preserve-delta` | boolean | `true` | Preserves initial movement delta rather than discarding it upon gesture recognition. |
| `catch-keyboard-switches` | boolean | `true` | Allows touchpad swipes to catch and redirect keyboard workspace switches. |
| `velocity-matching` | boolean | `true` | Matches animation release curve to instantaneous finger velocity. |
| `gentle-rest-release` | boolean | `true` | Uses ease-in-out curve when releasing stationary fingers to prevent kicks. |
| `allow-long-swipes` | boolean | `true` | Enables continuous gestures across multiple workspaces. |
| `speed-multiplier` | double | `1.0` | Multiplier for touchpad gesture tracking speed. |
| `flick-threshold` | int | `8` | Minimum distance in pixels required to recognize a directional flick. |
| `flick-time-window` | int | `350` | Maximum gesture duration in milliseconds to be recognized as a flick. |
| `hold-drag-threshold` | int | `20` | Distance in pixels to latch from a flick window into 1:1 interactive hold-drag. |

---

## Uninstallation

To disable and remove the extension completely:

```bash
UUID="smooth-touchpad-interrupt@osama.gemini"

# Disable extension
gnome-extensions disable ${UUID}

# Remove extension directory
rm -rf ~/.local/share/gnome-shell/extensions/${UUID}

# Reset extension settings (optional)
gsettings reset-recursively org.gnome.shell.extensions.smooth-touchpad-interrupt
```

Restart your GNOME Shell session (or log out and back in) to clear cached modules.

---

## Notes

- This extension is vibe-coded.
- Prototype modifications are managed via GNOME's `InjectionManager` and are restored cleanly when the extension is disabled.
- Works natively on Wayland and X11 sessions.

---

## License

GPL-2.0-or-later. See the [LICENSE](LICENSE) file for terms.
