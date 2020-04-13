import React, { useEffect, useState, useRef } from "react";
import { List } from "immutable";
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Link,
  Redirect
} from "react-router-dom";

const ClientMessage = (type, content) => JSON.stringify({[type]: content})
const ConsoleCommand = (command) => ClientMessage("ConsoleCommand", { command })

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

const handleConsoleInput = (webSocket) => {
    return (event) => {
        const messageText = event.target.value;
        if (event.key === "Enter") {
            event.target.value = "";
            webSocket.send(ConsoleCommand(messageText));
        }
    };
};

const Console = ({messages, webSocket}) => {
    const consoleRef = useRef(null);

    useEffect(() => {
        const consoleArea = consoleRef.current;
        consoleArea.scrollTop = consoleArea.scrollHeight;
    }, [messages]);

    return (
        <div className={"card fluid"}>
            <textarea ref={consoleRef} className={"row"} readOnly={true} value={messages.join("")}></textarea>
            <input className={"row"} onKeyDown={handleConsoleInput(webSocket)}></input>
        </div>
    );
};

const App = props => {
    const maxMessages = 100;
    const [webSocket,] = useState(new WebSocket("ws://127.0.0.1:8080"));
    const [messages, setMessages] = useState(List());

    useEffect(() => {
        webSocket.onmessage = (event) => {
            setMessages(msgs => {
                const serverMessage = JSON.parse(event.data);
                const consoleMessage = serverMessage["ConsoleMessage"];
                if (consoleMessage) {
                    if (msgs.size >= maxMessages) {
                        return msgs.shift().push(consoleMessage.message);
                    } else {
                        return msgs.push(consoleMessage.message);
                    }
                }
            });
        };

        webSocket.onclose = () => {
            webSocket.close();
        }

        webSocket.onopen = () => {
            webSocket.send(ConsoleCommand("server"));
        }

        return () => {
            webSocket.close();
        };
    }, []);

    return (
        <Router>
            <div className={"container"}>
                <Header />
                <Switch>
                    <Route path="/console">
                        <Console messages={messages} webSocket={webSocket} />
                    </Route>
                    <Route path="/pilots">
                        <div></div>
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
            </div>
        </Router>
    );
};

export default App;