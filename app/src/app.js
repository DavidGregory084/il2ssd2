import React, { useEffect, useState, useRef, useReducer, useContext } from "react";
import { List, Map } from "immutable";
import {
    HashRouter as Router,
    Switch,
    Route,
    Link,
    Redirect
} from "react-router-dom";

const ConnectionContext = React.createContext(false);

const Message = (type, content) => ({ type, ...content });

// Internal messages
const CONNECTION_MESSAGE = "ConnectionMessage";
const ConnectionMessage = (connected, webSocket) => Message(CONNECTION_MESSAGE, { connected, webSocket });

// Server messages
const CONSOLE_MESSAGE = "ConsoleMessage";
const PILOT_JOIN_MESSAGE = "PilotJoinMessage";
const PILOT_LEAVE_MESSAGE= "PilotLeaveMessage";

// Client messages
const CONSOLE_COMMAND = "ConsoleCommand";
const ConsoleCommand = (command) => Message(CONSOLE_COMMAND, { command });

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

const Footer = props => {
    const { connected } = useContext(ConnectionContext);
    const baseIconClass = "fas fa-circle";
    const iconClass = connected ? baseIconClass + " icon-green" : baseIconClass + " icon-red";
    const iconLabel = connected ? "Connected" : "Disconnected";
    return (
        <footer className={"row"}>
            <p>
                <i className={iconClass}></i>
                <label>{iconLabel}</label>
            </p>
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

const Pilots = ({ pilots }) => {
    return (
        <div className={"content"}>
            <table>
                <thead>
                    <tr>
                        <th>Socket</th>
                        <th>Name</th>
                        <th>IP</th>
                        <th>Port</th>
                    </tr>
                </thead>
                <tbody>{
                    pilots.toList().map(pilot => {
                        return (
                            <tr key={pilot.socket}>
                                <td data-label="Socket">{pilot.socket}</td>
                                <td data-label="Name">{pilot.name}</td>
                                <td data-label="IP">{pilot.ip}</td>
                                <td data-label="Port">{pilot.port}</td>
                            </tr>
                        );
                    })
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
    missions: {}
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
        case PILOT_LEAVE_MESSAGE:
            return { ...state, pilots: state.pilots.remove(message.socket) };
        default:
            console.log("Unknown message type: " + JSON.stringify(message));
            return state;
    }
}

const App = props => {
    const [appState, dispatch] = useReducer(AppReducer, InitialAppState)

    useEffect(() => {
        const webSocket = new WebSocket("ws://127.0.0.1:8080");

        webSocket.onmessage = (event) => {
            dispatch(JSON.parse(event.data));
        };

        webSocket.onclose = () => {
            dispatch(ConnectionMessage(false, null));
        }

        webSocket.onopen = () => {
            dispatch(ConnectionMessage(true, webSocket));
            webSocket.send(JSON.stringify(ConsoleCommand("server")));
        }

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
                    <Footer />
                </ConnectionContext.Provider>
            </div>
        </Router>
    );
};

export default App;
