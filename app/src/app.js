import React, { useEffect, useState, useRef, useReducer, useContext } from "react";
import { List, Map } from "immutable";
import {
    HashRouter as Router,
    Switch,
    Route,
    Link,
    Redirect
} from "react-router-dom";

const ConnectionContext = React.createContext({connected: false});

const Message = (type, content) => ({ type, ...content });

// Internal messages
const CONNECTION_MESSAGE = "ConnectionMessage";
const ConnectionMessage = (connected, webSocket) => Message(CONNECTION_MESSAGE, { connected, webSocket });

// Server messages
const CONSOLE_MESSAGE = "ConsoleMessage";
const PILOT_JOIN_MESSAGE = "PilotJoinMessage";
const HOST_MESSAGE = "HostMessage";
const USER_MESSAGE = "UserMessage";
const PILOT_LEAVE_MESSAGE= "PilotLeaveMessage";
const MISSION_PLAYING_MESSAGE = "MissionPlayingMessage";
const MISSION_LOADED_MESSAGE= "MissionLoadedMessage";
const MISSION_NOT_LOADED_MESSAGE= "MissionNotLoadedMessage";

// Client messages
const CONSOLE_COMMAND = "ConsoleCommand";
const ConsoleCommand = (command) => Message(CONSOLE_COMMAND, { command });

const MissionStatus = {
    PLAYING: "Playing",
    LOADED: "Loaded",
    NOT_LOADED: "NotLoaded"
};

const Header = props => {
    return (
        <header>
            <a className={"logo"}>IL-2 Simple Server Daemon</a>
            <Link to="/console" className={"button"}>Console</Link>
            <Link to="/pilots" className={"button"}>Pilots</Link>
            <Link to="/bans" className={"button"}>Ban List</Link>
            <Link to="/missions" className={"button"}>Missions</Link>
        </header>
    );
};

const ConnectionStatusDisplay = props => {
    const { connected } = useContext(ConnectionContext);
    const baseIconClass = "fas fa-circle";
    const iconClass = connected ? baseIconClass + " icon-green" : baseIconClass + " icon-red";
    const iconLabel = connected ? "Connected" : "Disconnected";
    return (
        <p className={"col-sm-2"}>
            <i className={iconClass}></i>
            <label>{iconLabel}</label>
        </p>
    );
};

const MissionStatusDisplay = ({ mission }) => {
    let iconClass;
    let iconLabel;

    switch (mission.status) {
        case MissionStatus.PLAYING:
            iconClass = "fas fa-play-circle icon-green";
            iconLabel = `Playing ${mission.mission}`
            break;
        case MissionStatus.LOADED:
            iconClass = "fas fa-pause-circle icon-green";
            iconLabel = `Loaded ${mission.mission}`
            break;
        case MissionStatus.NOT_LOADED:
            iconClass = "far fa-circle";
            iconLabel = "No mission loaded"
            break;
    }

    return (
        <p className={"col-sm"}>
            <i className={iconClass}></i>
            <label>{iconLabel}</label>
        </p>
    );
};

const Footer = ({ mission }) => {
    return (
        <footer className={"row"}>
            <ConnectionStatusDisplay />
            <MissionStatusDisplay mission={mission} />
        </footer>
    );
};

const handleConsoleInput = (webSocket) => {
    return (event) => {
        const messageText = event.target.value;
        if (event.key === "Enter") {
            event.target.value = "";
            webSocket.send(JSON.stringify(ConsoleCommand(messageText)));
        }
    };
};

const Console = ({ messages }) => {
    const consoleRef = useRef(null);
    const { connected, webSocket } = useContext(ConnectionContext);

    useEffect(() => {
        const consoleArea = consoleRef.current;
        consoleArea.scrollTop = consoleArea.scrollHeight;
    }, [messages]);

    return (
        <div className={"card fluid"}>
            <textarea ref={consoleRef} className={"row"} readOnly={true} value={messages.join("\n")}></textarea>
            <input className={"row"} disabled={!connected} onKeyDown={handleConsoleInput(webSocket)}></input>
        </div>
    );
};

const Kick = ({ pilot }) => {
    const { webSocket, connected } = useContext(ConnectionContext);
    return (
        <button
            title="Kick"
            disabled={!connected}
            className={"fas fa-thumbs-down small"}
            onClick={() => {
                webSocket.send(JSON.stringify(ConsoleCommand(`kick ${pilot.name}`)))
            }} />
    );
};

const Ban = ({ pilot }) => {
    const { webSocket, connected } = useContext(ConnectionContext);
    return (
        <button
            title="Ban"
            disabled={!connected}
            className={"fas fa-ban small"}
            onClick={() => {
                webSocket.send(JSON.stringify(ConsoleCommand(`ban ADD NAME ${pilot.name}`)))
                webSocket.send(JSON.stringify(ConsoleCommand(`kick ${pilot.name}`)));
            }} />
    );
};

const IPBan = ({ pilot }) => {
    const { webSocket, connected } = useContext(ConnectionContext);
    return (
        <button
            title="IP Ban"
            disabled={!connected}
            className={"fas fa-gavel small"}
            onClick={() => {
                webSocket.send(JSON.stringify(ConsoleCommand(`ban ADD IP ${pilot.ip}`)));
                webSocket.send(JSON.stringify(ConsoleCommand(`kick ${pilot.name}`)));
            }} />
    );
};

const Pilot = ({ pilot }) => {
    const style = pilot.army ? {backgroundColor: pilot.army.toLowerCase()} : {};
    return (
        <tr key={pilot.socket} style={style}>
            <td data-label="#" style={style}>{pilot.number}</td>
            <td data-label="Name" style={style}>{pilot.name}</td>
            <td data-label="Ping" style={style}>{pilot.ping || 0}</td>
            <td data-label="Score" style={style}>{pilot.score || 0}</td>
            <td data-label="Aircraft" style={style}>{pilot.aircraft || ""}</td>
            <td data-label="Actions" style={style}>
                <Kick pilot={pilot} />
                <Ban pilot={pilot} />
                <IPBan pilot={pilot} />
            </td>
        </tr>
    );
};

const Pilots = ({ pilots }) => {
    return (
        <div className={"card fluid"}>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Ping</th>
                        <th>Score</th>
                        <th>Aircraft</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>{
                    pilots
                        .toList()
                        .sortBy(pilot => pilot.number || pilot.socket)
                        .map(pilot => <Pilot pilot={pilot}/>)
                }</tbody>
            </table>
        </div>
    );
};

const InitialAppState = {
    connected: false,
    webSocket: null,
    messages: List(),
    pilots: Map(),
    bans: List(),
    mission: { status: MissionStatus.NOT_LOADED }
};

const MAX_CONSOLE_MESSAGES = 100;

const AppReducer = (state, message) => {
    switch (message.type) {
        case CONNECTION_MESSAGE:
            return { ...state, connected: message.connected, webSocket: message.webSocket };
        case CONSOLE_MESSAGE:
            const messages = state.messages.size > MAX_CONSOLE_MESSAGES ?
                state.messages.shift().push(message.message) :
                state.messages.push(message.message);
            return { ...state, messages };
        case PILOT_JOIN_MESSAGE:
            const pilot = { socket: message.socket, ip: message.ip, port: message.port, name: message.name };
            return { ...state, pilots: state.pilots.set(message.socket, pilot) };
        case HOST_MESSAGE:
            const host = { socket: message.socket, ip: message.ip, port: message.port, name: message.name, number: message.number };
            return { ...state, pilots: state.pilots.set(message.socket, host) };
        case USER_MESSAGE:
            const user = { number: message.number, ping: message.ping, score: message.score, army: message.army, aircraft: message.aircraft };
            const existing = state.pilots.find(p => p.number === user.number);
            const pilots = existing ? state.pilots.set(existing.socket, { ...existing, ...user }) : state.pilots;
            return { ...state, pilots };
        case PILOT_LEAVE_MESSAGE:
            return { ...state, pilots: state.pilots.remove(message.socket) };
        case MISSION_PLAYING_MESSAGE:
            return { ...state, mission: { ...state.mission, status: MissionStatus.PLAYING, mission: message.mission } };
        case MISSION_LOADED_MESSAGE:
            return { ...state, mission: { ...state.mission, status: MissionStatus.LOADED, mission: message.mission } };
        case MISSION_NOT_LOADED_MESSAGE:
            return { ...state, mission: { ...state.mission, status: MissionStatus.NOT_LOADED, mission: null } };
        default:
            console.log("Unknown message type: " + JSON.stringify(message));
            return state;
    }
};

const App = props => {
    const [appState, dispatch] = useReducer(AppReducer, InitialAppState);

    useEffect(() => {
        const wsProtocol = location.protocol === "https" ? "wss" : "ws";
        const webSocket = new WebSocket(`${wsProtocol}://${location.hostname}:8080`);

        webSocket.onmessage = (event) => {
            dispatch(JSON.parse(event.data));
        };

        webSocket.onclose = () => {
            dispatch(ConnectionMessage(false, null));
        };

        webSocket.onopen = () => {
            dispatch(ConnectionMessage(true, webSocket));
            webSocket.send(JSON.stringify(ConsoleCommand("server")));
            webSocket.send(JSON.stringify(ConsoleCommand("mission")));
            webSocket.send(JSON.stringify(ConsoleCommand("host")));
            webSocket.send(JSON.stringify(ConsoleCommand("user")));
        };

        return () => {
            webSocket.close();
        };
    }, []);

    return (
        <Router>
            <div className={"container"}>
                <ConnectionContext.Provider value={{ connected: appState.connected, webSocket: appState.webSocket }}>
                    <Header />
                    <Switch>
                        <Route path="/console">
                            <Console messages={appState.messages} />
                        </Route>
                        <Route path="/pilots">
                            <Pilots pilots={appState.pilots} />
                        </Route>
                        <Route path="/bans">
                            <div></div>
                        </Route>
                        <Route path="/missions">
                            <div></div>
                        </Route>
                        <Route path="/">
                            <Redirect to="/console" />
                        </Route>
                    </Switch>
                    <Footer mission={appState.mission} />
                </ConnectionContext.Provider>
            </div>
        </Router>
    );
};

export default App;
