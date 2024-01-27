/**
 * Copyright (C) 2023 Jeff Shee (jeffshee8969@gmail.com)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Meta from 'gi://Meta';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Logger from './logger.js';

const applicationId = 'io.github.jeffshee.HanabiRenderer';
const logger = new Logger.Logger();

export class AutoPause {
    constructor() {
        this._workspaces = new Set();
        this._windows = new Set();
        this._active_workspace = null;
        this._states = {
            maximizedOnAnyMonitor: false,
            fullscreenOnAnyMonitor: false,
            maximizedOrFullscreenOnAllMonitors: false,
        };

        // DBus
        const dbusXml = `
            <node>
                <interface name="io.github.jeffshee.HanabiRenderer">
                    <method name="setPlay"/>
                    <method name="setPause"/>
                    <property name="isPlaying" type="b" access="read"/>
                    <signal name="isPlayingChanged">
                        <arg name="isPlaying" type="b"/>
                    </signal>
                </interface>
            </node>`;
        const proxy = Gio.DBusProxy.makeProxyWrapper(dbusXml);
        this.proxy = proxy(Gio.DBus.session,
            'io.github.jeffshee.HanabiRenderer', '/io/github/jeffshee/HanabiRenderer');
    }

    enable() {
        const workspaceManager = global.workspace_manager;
        this._active_workspace = workspaceManager.get_active_workspace();
        for (let i = 0; i < workspaceManager.get_n_workspaces(); i++) {
            let workspace = workspaceManager.get_workspace_by_index(i);
            this._workspaces.add(workspace);
            this._monitorWorkspace(workspace);
            let metaWindows = workspace.list_windows();
            metaWindows.forEach(metaWindow => this._monitorWindow(metaWindow));
        }

        workspaceManager.connect('workspace-added', (_workspaceManager, index) => this._workspaceAdded(workspaceManager.get_workspace_by_index(index)));
        workspaceManager.connect('active-workspace-changed', () => this._activeWorkspaceChanged(workspaceManager.get_active_workspace()));

        // Initial check
        this.update();
    }

    update() {
        // Filter out renderer windows and minimized windows
        let metaWindows = this._active_workspace.list_windows().filter(
            metaWindow => !metaWindow.title?.includes(applicationId) && !metaWindow.minimized
        );

        const monitors = Main.layoutManager.monitors;

        this._states.maximizedOnAnyMonitor = metaWindows.some(metaWindow => metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH);
        this._states.fullscreenOnAnyMonitor = metaWindows.some(metaWindow => metaWindow.fullscreen);

        const monitorsWithMaximizedOrFullscreen = metaWindows.reduce((acc, metaWindow) => {
            if (metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH || metaWindow.fullscreen)
                acc[metaWindow.get_monitor()] = true;
            return acc;
        }, {});

        this._states.maximizedOrFullscreenOnAllMonitors = monitors.every(
            monitor => monitorsWithMaximizedOrFullscreen[monitor.index]
        );

        logger.log(this._states);

        this.proxy.call(
            this._states.maximizedOrFullscreenOnAllMonitors ? 'setPause' : 'setPlay', // method_name
            null, // parameters
            Gio.DBusCallFlags.NO_AUTO_START, // flags
            -1, // timeout_msec
            null, // cancellable
            null // callback
        );
    }

    _monitorWindow(metaWindow) {
        // Not need to monitor renderer window
        if (metaWindow.title?.includes(applicationId))
            return;
        metaWindow.connect('notify::maximized-horizontally', () => {
            logger.debug('maximized-horizontally changed');
            this.update();
        });
        metaWindow.connect('notify::maximized-vertically', () => {
            logger.debug('maximized-vertically changed');
            this.update();
        });
        metaWindow.connect('notify::fullscreen', () => {
            logger.debug('fullscreen changed');
            this.update();
        });
        metaWindow.connect('notify::minimized', () => {
            logger.debug('minimized changed');
            this.update();
        });
    }

    _monitorWorkspace(workspace) {
        workspace.connect('window-added', (_workspace, window) => this._windowAdded(window));
        workspace.connect('window-removed', (_workspace, window) => this._windowRemoved(window));
    }

    _windowAdded(window) {
        this._windows.add(window);
        this._monitorWindow(window);
        logger.debug(`Window ${window.title} added`);
        this.update();
    }

    _windowRemoved(window) {
        this._windows.delete(window);
        logger.debug(`Window ${window.title} removed`);
        this.update();
    }

    _workspaceAdded(workspace) {
        this._workspaces.add(workspace);
        this._monitorWorkspace(workspace);
        logger.debug(`Workspace ${workspace.workspace_index} added`);
    }

    _activeWorkspaceChanged(workspace) {
        this._active_workspace = workspace;
        logger.debug(`Active workspace changed to ${this._active_workspace.workspace_index}`);
        this.update();
    }

    disable() {
        // TODO
    }
}