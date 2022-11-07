// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const process = require("process");
const fs = require("fs");
const path = require("path");

const Tools = {
    Uri: function(path) {
        return path? vscode.Uri.file(path) : path;
    },
    Path: function(path) {
        return path? vscode.Uri.file(path).fsPath : path;
    },
    Prompt: function(msg, callback, warn = true) {
        (warn? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(
            msg, {modal: true}, "Yes").then(res => { if (res === "Yes") callback(); });
    },
    OpenFileDialog: function(title, defaultPath, filters, callback) {
        vscode.window.showOpenDialog({title: title, defaultUri: this.Uri(defaultPath), 
            openLabel:"Open", filters: filters, canSelectMany: false}).then(res =>{
                if (res && res[0] && res[0].scheme === "file") callback(res[0].path);
            });
    },
    Clone: function(obj) { return obj? JSON.parse(JSON.stringify(obj)) : obj; }
}

String.prototype.cut = function(start, end) {
    return (end > start)? this.substring(0, start) + this.substring(end + 1, this.length) : "";
};

const Configuration = {
    Path: "",
    Default: "",
    Initialize: function(context) {
        this.Path = context.globalStoragePath + "/terminal-sessions.json";
        if (process.platform === "linux") {
            this.Default = [{
                Title: "Bash",
                ShellPath: "/bin/bash",
                ShellArgs: [ "-l" ]
            },
            {
                Title: "SH",
                ShellPath: "/bin/sh"
            }];
        } else if (process.platform === "win32") {
            this.Default = [{
                Title: "PowerShell",
                ShellPath: "/C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
            },
            {
                Title: "Command Prompt",
                ShellPath: "/C:/Windows/System32/cmd.exe",
                ShellArgs: [ "/K", "echo Hello." ]
            }];
        } else {
            this.Default = [{
                Title: "SH",
                ShellPath: "/bin/sh"
            }];
        }
    
        if (!fs.existsSync(context.globalStoragePath));
            fs.promises.mkdir(context.globalStoragePath, {recursive:true}).catch( (e) => {
                vscode.window.showErrorMessage("Error creating storage path: " + String(e));
            });
    
        if (!fs.existsSync(this.Path))
            fs.promises.writeFile(this.Path, JSON.stringify(this.Default, null, 4)).catch( (e) => {
                vscode.window.showErrorMessage("Error writing configuration: " + String(e));
            });
    },
    Load: function(force) {
        let sessions = null;
        try {
            const configsLocal = fs.readFileSync(this.Path);
            sessions = JSON.parse(configsLocal);

            /* Check for Title and ShellPath which is mandatory */
            for (let session of sessions) {
                if (!session.Title.length) throw("Title is empty");
                if (!session.ShellPath.length) throw("ShellPath is empty");
            }
        } catch (e) {
            sessions = null;
        }

        if (!sessions && force) {
            sessions = Configuration.Default;
        }

        return sessions;
    },
    Overwrite: function(configs) {
        fs.promises.writeFile(this.Path, JSON.stringify(configs, null, 4));
    }
};

class SessionItem extends vscode.TreeItem {
    constructor(id, label, path, args, tab, icon) {
        let bTab = tab? ((tab === "true")? true: false) : false;
        super(label);
        this.id = id;
        this.contextValue = bTab? "session-tab" : "session";
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.description = "";
        this.iconPath = icon;
        this.tootip = "Open " + label + " at " + (bTab? "panel." : "Editor's tab.");
        /* The command object register the command and arguments to pass to callback function */
        this.command = {
                command: "term-sess-mgr.sessionSelected",
                title: "Session selected", 
                arguments: [this] // Pass itself to the command like rest of the item's context menu.
            };
        this.shellPath = path;
        this.shellArgs = args;
    }
}

class SessionsList {
    constructor() {
        this.eventEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.eventEmitter.event;
        this.sessions = [];
        this.configSessions = [];
        this.cntLoadError = 0;
    }

    renameSession(id, label) {
        this.sessions[id].label = this.configSessions[id].Title = label;
        this.overwriteConfig();
        this.eventEmitter.fire();
    }

    changeSessionShell(id, shell) {
        this.sessions[id].shellPath = this.configSessions[id].ShellPath = shell;
        this.overwriteConfig();
        this.eventEmitter.fire();
    }

    changeSessionIcon(id, icon) {
        this.sessions[id].iconPath = this.configSessions[id].IconPath = icon;
        this.overwriteConfig();
        this.eventEmitter.fire();
    }

    switchSessionTab(id) {
        let bTab = (this.sessions[id].contextValue === "session");
        this.sessions[id].contextValue = bTab? "session-tab" : "session";
        this.configSessions[id].TabView = bTab? "true" : "false";
        this.overwriteConfig();
        this.eventEmitter.fire();
    }

    changeSessionArguments(id, shellArgs) {
        this.sessions[id].shellArgs = this.configSessions[id].ShellArgs = shellArgs;
        this.overwriteConfig();
    }

    copySession(id) {
        var config = Tools.Clone(this.configSessions[id]);
        config.Title += " - Copy"
//        this.configSessions.push(config);
        this.configSessions.splice(++id, 0, config);
        this.overwriteConfig();
        this.sessions.splice(id, 0, new SessionItem(id, config.Title, config.ShellPath, config.ShellArgs, config.TabView, config.IconPath));
        while (++id < this.sessions.length) this.sessions[id].id = id;
        this.eventEmitter.fire();
    }

    deleteSession(id) {
        this.configSessions.splice(id, 1);
        this.overwriteConfig();
        this.sessions[id].id = -1;
        this.sessions.splice(id, 1);
        while (id < this.sessions.length) this.sessions[id].id = id++;
        this.eventEmitter.fire();
    }

    overwriteConfig() {
        Configuration.Overwrite(this.configSessions);
        this.cntLoadError = 0;
    }

    reloadSessions(force) {
        let configSessions = Configuration.Load(false);

        if (!configSessions && force)
            configSessions = Configuration.Load(force);

        if (configSessions && configSessions.length > 0) {
            this.cntLoadError = 0;
            let id = 0;
            for (let session of this.sessions) session.id = -1;
            this.sessions.length = 0;
            this.configSessions.length = 0;
            for (let config of configSessions) {
                this.sessions.push(new SessionItem(id, config.Title, config.ShellPath, config.ShellArgs, config.TabView, config.IconPath));
				this.configSessions.push(config);
                ++id;
            }
            this.eventEmitter.fire();
        } else if (this.configSessions.length > 0) {
            if (this.cntLoadError > 1) {
                Tools.Prompt("There is error on configuration, want to overwrite it with current list?", () => {
                            this.overwriteConfig();
                        });
            } else {
                ++this.cntLoadError;
                vscode.window.showWarningMessage("There is error on configuration, please correct it.");
            }
        }
    }

	getChildren(element) {
		if (element) {
            return null;
        }
		return this.sessions;
	}

	getTreeItem(element) {
        return element;
    }
}

class SessionsManager {
    constructor(context) {
        this.context = context;

        this.listSessions = new SessionsList();

        // The command has been defined in the package.json file
    	// Now provide the implementation of the command with  registerCommand
	    // The commandId parameter must match the command field in package.json

        /* The way to bind the this pointer to callback */
        this.registerLocalCommand("refreshConfiguration", () => this.reloadSessions()); 
        this.registerLocalCommand("editConfiguration", () => this.editLocalConfiguration());

        /* Different way to pass the arguments to callback and bind the this pointer */
        this.registerLocalCommand("sessionSelected",  (...args) => this.sessionSelected(...args));
        this.registerLocalCommand("session.openAtEditorArea", (item) => this.sessionOpenAtEditorArea(item));
        this.registerLocalCommand("session.openAtDefaultArea", (...args) => this.sessionOpenAtDefaultArea(...args));
        this.registerLocalCommand("session.Rename", (item => { this.sessionRename(item); }));
        this.registerLocalCommand("session.ChangeShell", (...args) => { this.sessionChangeShell(...args); });
        this.registerLocalCommand("session.ChangeIcon", (item) => this.sessionChangeIcon(item));
        this.registerLocalCommand("session.EditArguments", (item => { this.sessionEditArguments(item); }));
        this.registerLocalCommand("session.Copy", (item) => this.sessionCopy(item));
        this.registerLocalCommand("session.Delete", (item) => this.sessionDelete(item));
        this.registerLocalCommand("session.EnableTab", (item) => { this.listSessions.switchSessionTab(item.id); });
        this.registerLocalCommand("session.DisableTab", (item) => { this.listSessions.switchSessionTab(item.id); });

        let listviewSessions = vscode.window.createTreeView("terminal-sessions", {treeDataProvider:  this.listSessions});
    
        this.context.subscriptions.push(listviewSessions);
        let click= { id: -1, time: 0 };
        this.click = click;

        Promise.resolve(this.context.subscriptions);
    }

    registerLocalCommand(nameCmd, callback){
        let cmd = vscode.commands.registerCommand("term-sess-mgr." + nameCmd, callback);
        this.context.subscriptions.push(cmd);
    }

    editLocalConfiguration() {
         vscode.window.showTextDocument(Tools.Uri(Configuration.Path));
    }
    
    createTerminal(item, editorArea = false) {
        let strLast, charStart, charEnd, beginStr, endStr;
        /* ShellArgs are all referenced, clone a new instance. */
        let shellArgs = item.shellArgs? Tools.Clone(item.shellArgs) : [];
        let shellTitle = item.label;
        let shellPath = Tools.Path(item.shellPath);
        let iconUri = Tools.Uri(item.iconPath);
        let first = true;

        if (shellArgs.length > 1 && (strLast = shellArgs[shellArgs.length - 1]).length == 5 && 
            (strLast === "(...)" || strLast === "[...]" || strLast === "{...}")) {
            charStart = strLast.charAt(0);
            charEnd = strLast.charAt(4);
            while ((beginStr = shellTitle.indexOf(charStart) + 1) > 0) {
                if ((endStr = shellTitle.indexOf(charEnd, beginStr)) > 0 ) {
                    if (first) {
                        first = false;
                        shellArgs.length -= 1;
                    }
                    shellArgs.push(shellTitle.slice(beginStr, endStr));
                    shellTitle = shellTitle.cut(beginStr - 1, endStr);
                }
            }
        }

        shellTitle = shellTitle.trimEnd();
        if (!shellTitle.length) shellTitle = item.label;

        for(let i = 1; i < 30; ++i) {
            let newTitle = shellTitle + " (" + i.toString() + ")";
            for (let windTerm of vscode.window.terminals) {
                if (newTitle === windTerm.name) {
                    newTitle = "";
                    break;
                }
            }
            if (newTitle.length > 2) {
                shellTitle = newTitle;
                break;
            }
        }

        if (editorArea)
            /* To open the terminal on editor area. */
            vscode.window.createTerminal({name: shellTitle, shellPath: shellPath, 
                location: {viewColumn: -1}, shellArgs: shellArgs, iconPath: iconUri}).show();
        else 
            vscode.window.createTerminal({name: shellTitle, shellPath: shellPath, 
                shellArgs: shellArgs, iconPath: iconUri}).show();
    }

    sessionSelected(item) {
        let current = Date.now();
        if (this.click.id === item.id && (current - this.click.time) < 500) {
            this.click = { id: -1, time: 0 };
            this.createTerminal(item, (item.contextValue === "session-tab"));
        } else {
            this.click.id = item.id;
            this.click.time = current;
        }
    }

    sessionOpenAtDefaultArea(item) {
        this.createTerminal(item);
    }

    sessionOpenAtEditorArea(item) {
        this.createTerminal(item, true);
    }

    sessionRename(item) {
        vscode.window.showInputBox({title: "Rename session", ignoreFocusOut: true, value: item.label})
            .then(res => {
                if (res && res !== item.label) {
                    if (item.id !== -1)
                        this.listSessions.renameSession(item.id, res);
                    else
                        vscode.window.showInformationMessage("Session \"" + item.label + "\" deleted or sessions refreshed!!!");
                }
            });
    }

    sessionChangeShell(item) {
        Tools.OpenFileDialog("Select shell for \"" + item.label + "\"", item.shellPath, 
            {}, (path => { this.listSessions.changeSessionShell(item.id, path) }));
    }

    sessionChangeIcon(item) {
        Tools.OpenFileDialog("Select icon for \"" + item.label + "\"", item.iconPath, 
            { Images: ["png","jpg","ico","bmp"] }, (path) => this.listSessions.changeSessionIcon(item.id, path));
    }

    sessionEditArguments(item) {
        let shellArgs = item.shellArgs? Tools.Clone(item.shellArgs) : [];
        let actsArgs = ["Edit existing argument.", "Add new argument.", "Delete an argument.", "Save and exit."];
        let actsNoArg = ["Add new argument.", "Complete."];
        let options = {
            title: "Edit arguments for " + item.label, 
            placeHolder: "Select an action", 
            canPickMany: false, 
            ignoreFocusOut: true
        };
        let listSessions = this.listSessions, i = 0, act = '';

        // Callback declaration that will bind this pointer
        let funcRespond = (arg => {
            if (item.id !== -1) {
                if (shellArgs.length === 0 || 
                    (shellArgs.length === 1 && shellArgs[0].length === 0)) shellArgs = undefined;
                this.listSessions.changeSessionArguments(item.id, shellArgs);
            } else
                vscode.window.showInformationMessage("Session \"" + item.label + "\" deleted or sessions refreshed!!!");
        });
        let funcActions = ({});
        let funcEditArgument = (arg =>{
            vscode.window.showInputBox({title: "Edit argument for " + item.label, ignoreFocusOut: true, value: shellArgs[i]})
                .then(res => {
                    if (res && res !== shellArgs[i]) {
                        shellArgs[i] = res;
                    }

                    return funcActions();
                });
        });
    
        funcActions = (arg => {
            let actions = shellArgs.length? actsArgs : actsNoArg;
            vscode.window.showQuickPick(actions, options).then(res => {
                if (!res.length) return;
                let selections = [];
                act = res.charAt(0);
 
                for (let arg of shellArgs) selections.push((selections.length + 1) + ". " + arg);
    
                switch(act) {
                    case 'A' :
                        if (!shellArgs.length) {
                            shellArgs.push("");
                            return funcEditArgument();                
                        }
                        selections.push((selections.length + 1) + ".");
                        options.placeHolder = "Select a position to add."
                        break;
                    
                    case 'E' :
                        if (!shellArgs.length) {
                            vscode.window.showWarningMessage("No argument exist!!!")
                            return funcActions();                
                        }
                        options.placeHolder = "Select an argument to edit.";
                        break;

                    case 'D' :
                        if (!shellArgs.length) {
                            vscode.window.showWarningMessage("No argument exist!!!")
                            return funcActions();                
                        }
                        options.placeHolder = "Select an argument to delete.";
                        break;

                    case 'S' :
                           return funcRespond(); 
    
                    default:
                        return;
                }
 
                vscode.window.showQuickPick(selections, options).then(res => {
                    if (res.indexOf('.') < 1) return;
                    i = Number(res.substring(0, res.indexOf('.'))) - 1;

                    switch(act) {
                        case 'D' :
                            shellArgs.splice(i, 1);
                            return funcActions();
    
                        case 'A' :
                            if (i === shellArgs.length) shellArgs.push("");
                            else shellArgs.splice(i, 0, "");
                            break;
                    }

                    return funcEditArgument();    
                });
            });
        });

        funcActions();
    }
    
    sessionCopy(item) {
        Tools.Prompt("Copy a new session of \"" + item.label + "\"?", () => { this.listSessions.copySession(item.id); }, true);
    }

    sessionDelete(item) {
        Tools.Prompt("Delete \"" + item.label + "\"?", () => { this.listSessions.deleteSession(item.id); });
    }

	reloadSessions(force = false) {
        this.listSessions.reloadSessions(force);
        return Promise.resolve(this.context.subscriptions)
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "term-sess-mgr" is now active!');

    Configuration.Initialize(context);
	let sessionsManager = new SessionsManager(context);
	sessionsManager.reloadSessions(true);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}