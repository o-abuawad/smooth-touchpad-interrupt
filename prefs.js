// SPDX-License-Identifier: GPL-2.0-or-later
// Preferences for Smooth Touchpad Animation Interruption

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SmoothTouchpadInterruptPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const _ = this.gettext.bind(this);
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Touchpad Gestures'),
            icon_name: 'input-touchpad-symbolic',
        });
        window.add(page);

        // Group 1: Interruption and Catching
        const interruptGroup = new Adw.PreferencesGroup({
            title: _('Animation Interruption and Catching'),
            description: _('Configure how touchpad gestures latch onto and catch animations mid-motion.'),
        });
        page.add(interruptGroup);

        // instant-catch
        const instantCatchRow = new Adw.SwitchRow({
            title: _('Instant Interruption Catch'),
            subtitle: _('Immediately halt and take control of running animations upon touch, bypassing the 16px deadzone.'),
        });
        settings.bind('instant-catch', instantCatchRow, 'active', 0);
        interruptGroup.add(instantCatchRow);

        // preserve-delta
        const preserveDeltaRow = new Adw.SwitchRow({
            title: _('Preserve Gesture Delta'),
            subtitle: _('Apply the accumulated drag motion rather than discarding it when a gesture recognizes.'),
        });
        settings.bind('preserve-delta', preserveDeltaRow, 'active', 0);
        interruptGroup.add(preserveDeltaRow);

        // catch-keyboard-switches
        const catchKeyboardRow = new Adw.SwitchRow({
            title: _('Catch Keyboard Workspace Switches'),
            subtitle: _('Allow touchpad swipes to seamlessly interrupt and redirect workspace transitions started by keyboard shortcuts.'),
        });
        settings.bind('catch-keyboard-switches', catchKeyboardRow, 'active', 0);
        interruptGroup.add(catchKeyboardRow);

        // Group 2: Kinetic Physics and Easing
        const physicsGroup = new Adw.PreferencesGroup({
            title: _('Kinetic Continuity and Motion Physics'),
            description: _('Configure momentum transfer and velocity continuity when releasing gestures.'),
        });
        page.add(physicsGroup);

        // velocity-matching
        const velocityRow = new Adw.SwitchRow({
            title: _('Velocity Continuity Hand-Off'),
            subtitle: _('Match the animation release duration to your finger flick speed, eliminating abrupt velocity jumps.'),
        });
        settings.bind('velocity-matching', velocityRow, 'active', 0);
        physicsGroup.add(velocityRow);

        // gentle-rest-release
        const gentleRestRow = new Adw.SwitchRow({
            title: _('Gentle Rest Release'),
            subtitle: _('Use an ease-in-out curve when releasing stationary fingers, preventing sudden kicks into snap points.'),
        });
        settings.bind('gentle-rest-release', gentleRestRow, 'active', 0);
        physicsGroup.add(gentleRestRow);

        // allow-long-swipes
        const longSwipesRow = new Adw.SwitchRow({
            title: _('Continuous Multi-Workspace Swipes'),
            subtitle: _('Enable continuous gestures and rapid flicks across multiple workspaces without bounding restrictions.'),
        });
        settings.bind('allow-long-swipes', longSwipesRow, 'active', 0);
        physicsGroup.add(longSwipesRow);

        // Group 3: Sensitivity Tuning
        const tuningGroup = new Adw.PreferencesGroup({
            title: _('Sensitivity and Tuning'),
            description: _('Fine-tune flick detection thresholds and gesture tracking sensitivity.'),
        });
        page.add(tuningGroup);

        // flick-threshold
        const flickThresholdRow = new Adw.SpinRow({
            title: _('Flick Recognition Distance (px)'),
            subtitle: _('Minimum finger movement in pixels required to register a directional flick.'),
            adjustment: new Gtk.Adjustment({
                lower: 4,
                upper: 30,
                step_increment: 1,
                page_increment: 2,
                value: settings.get_int('flick-threshold'),
            }),
            digits: 0,
        });
        settings.bind('flick-threshold', flickThresholdRow.adjustment, 'value', 0);
        tuningGroup.add(flickThresholdRow);

        // flick-time-window
        const flickWindowRow = new Adw.SpinRow({
            title: _('Flick Time Window (ms)'),
            subtitle: _('Maximum gesture duration in milliseconds to be recognized as a quick flick.'),
            adjustment: new Gtk.Adjustment({
                lower: 150,
                upper: 600,
                step_increment: 25,
                page_increment: 50,
                value: settings.get_int('flick-time-window'),
            }),
            digits: 0,
        });
        settings.bind('flick-time-window', flickWindowRow.adjustment, 'value', 0);
        tuningGroup.add(flickWindowRow);

        // hold-drag-threshold
        const holdDragRow = new Adw.SpinRow({
            title: _('Hold-Drag Latch Distance (px)'),
            subtitle: _('Distance in pixels to transition from a flick window into 1:1 interactive hold-drag during an animation.'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 50,
                step_increment: 2,
                page_increment: 5,
                value: settings.get_int('hold-drag-threshold'),
            }),
            digits: 0,
        });
        settings.bind('hold-drag-threshold', holdDragRow.adjustment, 'value', 0);
        tuningGroup.add(holdDragRow);

        // speed-multiplier
        const speedRow = new Adw.SpinRow({
            title: _('Gesture Tracking Speed Multiplier'),
            subtitle: _('Scale how fast workspace and overview animations follow touchpad movements.'),
            adjustment: new Gtk.Adjustment({
                lower: 0.5,
                upper: 2.5,
                step_increment: 0.1,
                page_increment: 0.2,
                value: settings.get_double('speed-multiplier'),
            }),
            digits: 1,
        });
        settings.bind('speed-multiplier', speedRow.adjustment, 'value', 0);
        tuningGroup.add(speedRow);
    }
}
