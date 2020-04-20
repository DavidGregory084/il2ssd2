import React, { useEffect, useState, useRef, useReducer, useContext } from "react";
import { List, Map } from "immutable";
import {
    HashRouter as Router,
    Switch,
    Route,
    Link,
    Redirect
} from "react-router-dom";

const AppContext = React.createContext({connected: false});

const Message = (type, content) => ({ type, ...content });

// Internal messages
const CONNECTION_MESSAGE = "ConnectionMessage";
const ConnectionMessage = (connected, webSocket) => Message(CONNECTION_MESSAGE, { connected, webSocket });
const CLEAR_BANS_MESSAGE = "ClearBansMessage";
const ClearBansMessage = () => Message(CLEAR_BANS_MESSAGE, {});

// Server messages
const CONSOLE_MESSAGE = "ConsoleMessage";
const PILOT_JOIN_MESSAGE = "PilotJoinMessage";
const HOST_MESSAGE = "HostMessage";
const USER_MESSAGE = "UserMessage";
const PILOT_LEAVE_MESSAGE= "PilotLeaveMessage";
const MISSION_PLAYING_MESSAGE = "MissionPlayingMessage";
const MISSION_LOADED_MESSAGE= "MissionLoadedMessage";
const MISSION_NOT_LOADED_MESSAGE= "MissionNotLoadedMessage";
const IP_BAN_MESSAGE = "IPBanMessage";
const NAME_BAN_MESSAGE = "NameBanMessage";
const DIFFICULTY_MESSAGE = "DifficultyMessage";

// Client messages
const CONSOLE_COMMAND = "ConsoleCommand";
const ConsoleCommand = (command) => Message(CONSOLE_COMMAND, { command });

const MissionStatus = {
    PLAYING: "Playing",
    LOADED: "Loaded",
    NOT_LOADED: "NotLoaded"
};

const BanType = {
    IP: "IP",
    NAME: "Name"
};

const Header = props => {
    return (
        <header>
            <a className={"logo"}>IL-2 Simple Server Daemon</a>
            <Link to="/pilots" className={"button"}>Pilots</Link>
            <Link to="/mission" className={"button"}>Mission</Link>
            <Link to="/bans" className={"button"}>Bans</Link>
            <Link to="/difficulty" className={"button"}>Difficulty</Link>
            <Link to="/console" className={"button"}>Console</Link>
        </header>
    );
};

const ConnectionStatusDisplay = props => {
    const { connected } = useContext(AppContext);
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
    const { connected, webSocket } = useContext(AppContext);

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

const KickButton = ({ pilot }) => {
    const { webSocket, connected } = useContext(AppContext);
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

const BanButton = ({ pilot }) => {
    const { webSocket, connected, dispatch } = useContext(AppContext);
    return (
        <button
            title="Ban"
            disabled={!connected}
            className={"fas fa-ban small"}
            onClick={() => {
                dispatch(ClearBansMessage());
                webSocket.send(JSON.stringify(ConsoleCommand(`ban ADD NAME ${pilot.name}`)))
                webSocket.send(JSON.stringify(ConsoleCommand(`kick ${pilot.name}`)));
                webSocket.send(JSON.stringify(ConsoleCommand("ban")));
            }} />
    );
};

const IPBanButton = ({ pilot }) => {
    const { webSocket, connected, dispatch } = useContext(AppContext);
    return (
        <button
            title="IP Ban"
            disabled={!connected}
            className={"fas fa-gavel small"}
            onClick={() => {
                dispatch(ClearBansMessage());
                webSocket.send(JSON.stringify(ConsoleCommand(`ban ADD IP ${pilot.ip}`)));
                webSocket.send(JSON.stringify(ConsoleCommand(`kick ${pilot.name}`)));
                webSocket.send(JSON.stringify(ConsoleCommand("ban")));
            }} />
    );
};

const Pilot = ({ pilot }) => {
    const style = pilot.army ? {backgroundColor: pilot.army.toLowerCase()} : {};
    return (
        <tr key={pilot.name} style={style}>
            <td data-label="#" style={style}>{pilot.number}</td>
            <td data-label="Name" style={style}>{pilot.name}</td>
            <td data-label="Ping" style={style}>{pilot.ping || 0}</td>
            <td data-label="Score" style={style}>{pilot.score || 0}</td>
            <td data-label="Aircraft" style={style}>{pilot.aircraft || ""}</td>
            <td data-label="Actions" style={style}>
                <KickButton pilot={pilot} />
                <BanButton pilot={pilot} />
                <IPBanButton pilot={pilot} />
            </td>
        </tr>
    );
};

const Pilots = ({ pilots }) => {
    const { webSocket } = useContext(AppContext);

    useEffect(() => {
       webSocket && webSocket.send(JSON.stringify(ConsoleCommand("host")));
       webSocket && webSocket.send(JSON.stringify(ConsoleCommand("user")));
    }, [webSocket]);

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

const LiftBanButton = ({ ban }) => {
    const { webSocket, connected, dispatch } = useContext(AppContext);
    return (
        <button
            title="Lift Ban"
            disabled={!connected}
            className={"fas fa-minus-circle small"}
            onClick={() => {
                dispatch(ClearBansMessage());
                webSocket.send(JSON.stringify(ConsoleCommand(`ban REM ${ban.type.toUpperCase()} ${ban.name || ban.ip}`)));
                webSocket.send(JSON.stringify(ConsoleCommand("ban")));
            }} />
    );
};

const Ban = ({ ban }) => {
    return (
        <tr key={ban.name || ban.ip}>
            <td data-label="Type">{ban.type}</td>
            <td data-label="Name / IP">{ban.name || ban.ip}</td>
            <td data-label="Actions">
                <LiftBanButton ban={ban} />
            </td>
        </tr>
    );
};

const Bans = ({ bans })=> {
    const { webSocket } = useContext(AppContext);

    useEffect(() => {
       webSocket && webSocket.send(JSON.stringify(ConsoleCommand("ban")));
    }, [webSocket]);

    return (
        <div className={"card fluid"}>
            <table>
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Name / IP</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>{bans.map(ban => <Ban ban={ban}/>)}</tbody>
            </table>
        </div>
    );
};

const DifficultySetting = ({ missionStatus, setting }) => {
    const { webSocket, connected } = useContext(AppContext);
    return (
        <tr key={setting[0]} >
            <td data-label="Setting">{setting[0]}</td>
            <td data-label="Enabled">
                <input
                    type="checkbox"
                    disabled={!connected || missionStatus === MissionStatus.PLAYING}
                    checked={setting[1]}
                    onChange={() => {
                        const inverted = setting[1] ? "0" : "1";
                        webSocket.send(JSON.stringify(ConsoleCommand(`difficulty ${setting[0]} ${inverted}`)));
                        webSocket.send(JSON.stringify(ConsoleCommand("difficulty")));
                    }} />
            </td>
        </tr>
    );
};

const Difficulty = ({ missionStatus, difficulty }) => {
    const { webSocket } = useContext(AppContext);

    useEffect(() => {
       webSocket && webSocket.send(JSON.stringify(ConsoleCommand("difficulty")));
    }, [webSocket]);

    return (
        <div className={"card fluid"}>
            <table>
                <thead>
                    <tr>
                        <th>Setting</th>
                        <th>Enabled</th>
                    </tr>
                </thead>
                <tbody>{
                    List(difficulty)
                        .sortBy(setting => setting[0])
                        .map(setting => <DifficultySetting missionStatus={missionStatus} setting={setting}/>)
                }</tbody>
            </table>
        </div>
    );
};

const Mission = props => {
    return (
        <div className={"card fluid"}></div>
    );
};

const InitialAppState = {
    connected: false,
    webSocket: null,
    messages: List(),
    pilots: Map(),
    bans: List(),
    difficulty: Map(),
    mission: { status: MissionStatus.NOT_LOADED }
};

const MAX_CONSOLE_MESSAGES = 100;

const AppReducer = (state, message) => {
    switch (message.type) {
        case CONNECTION_MESSAGE:
            return { ...state, connected: message.connected, webSocket: message.webSocket };
        case CLEAR_BANS_MESSAGE:
            return { ...state, bans: List() };
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
        case IP_BAN_MESSAGE:
            return { ...state, bans: state.bans.push({type: BanType.IP, ip: message.ip}) };
        case NAME_BAN_MESSAGE:
            return { ...state, bans: state.bans.push({type: BanType.NAME, name: message.name}) };
        case DIFFICULTY_MESSAGE:
            return { ...state, difficulty: state.difficulty.set(message.setting, message.enabled) };
        default:
            console.log("Unknown message type: " + JSON.stringify(message));
            return state;
    }
};

const App = props => {
    const [appState, dispatch] = useReducer(AppReducer, InitialAppState);

    useEffect(() => {
        const isProduction = process.env.NODE_ENV === "production";
        const wsProtocol = location.protocol === "https" ? "wss" : "ws";
        const wsHostName = isProduction ? location.hostname :  process.env.IL2SSD_HOST;
        const wsPortNumber = process.env.IL2SSD_PORT;
        const webSocket = new WebSocket(`${wsProtocol}://${wsHostName}:${wsPortNumber}`);

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
        };

        return () => {
            webSocket.close();
        };
    }, []);

    return (
        <Router>
            <div className={"container"}>
                <AppContext.Provider value={{ connected: appState.connected, webSocket: appState.webSocket, dispatch }}>
                    <Header />
                    <Switch>
                        <Route exact path="/">
                            <Redirect to="/pilots" />
                        </Route>
                        <Route path="/pilots">
                            <Pilots pilots={appState.pilots} />
                        </Route>
                        <Route path="/mission">
                            <Mission />
                        </Route>
                        <Route path="/bans">
                            <Bans bans={appState.bans} />
                        </Route>
                        <Route path="/difficulty">
                            <Difficulty missionStatus={appState.mission.status} difficulty={appState.difficulty} />
                        </Route>
                        <Route path="/console">
                            <Console messages={appState.messages} />
                        </Route>
                    </Switch>
                    <Footer mission={appState.mission} />
                </AppContext.Provider>
            </div>
        </Router>
    );
};

export default App;
