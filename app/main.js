const {app, BrowserWindow, dialog, ipcMain} = require('electron');
const path = require('path');
const url = require('url');
const Store = require('electron-store');
const electronLocalshortcut = require('electron-localshortcut');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const gau = require('github-app-updater');
const args = require('minimist')(process.defaultApp ? process.argv.slice(3) : process.argv.slice(1), {
	default: {
		_: process.cwd()
	}
});

let win;
let repoDir = path.resolve(path.normalize(args._.join(' ')));
let repoRootDir = repoDir;

//auto update stuff
if (process.platform === 'win32') {
	setTimeout(() => {
		gau.checkForUpdate({
			currentVersion: app.getVersion(),
			repo: 'https://api.github.com/repos/pirol541/gitlit/releases/latest',
			assetMatch: /.+setup.+exe/i
		});

		gau.onUpdateAvailable = (version, asset) => {
			win.webContents.send('update', {
				event: 'updateAvailable',
				version: version,
				asset: asset
			});
		};

		gau.onNewVersionReadyToInstall = (file) => {
			win.webContents.send('update', {
				event: 'updateReadyToInstall',
				file: file
			});
		};

		ipcMain.on('downloadUpdate', (event, asset) => {
			gau.downloadNewVersion(asset);
		});

		ipcMain.on('installUpdate', (event, file) => {
			gau.executeUpdate(file);
			win.webContents.send('update', {
				event: 'updateInstalling'
			});
			app.quit();
		});
	}, 5000);
}
//end update stuff

function lockFile(file) {
	exec('git lfs lock --json "' + file + '"', 
		{	maxBuffer: (1024 * 1024) * 10, //10MB
			cwd: repoDir
		},
		(error, stdout, stderr) => {
			let notification = {
				message: (error && error.message) || stderr,
				type: 'error'
			};
			if (stdout) {
				notification = {
					file: file,
					event: 'lock',
					data: JSON.parse(stdout),
					type: 'info'
				};
			}
			win.webContents.send('notification', notification);
		}
	);
};

function getLfsFileList(dir, cb) {
	exec('git ls-files | git check-attr --stdin lockable', {
		maxBuffer: (1024 * 1024) * 10, //10MB
		cwd: dir
	},
	(error, stdout, stderr) => {
		if (error) {
			cb(error);
			return;
		}

		let parsedFiles = [];
		if (stdout) {
			let files = stdout.split('\n');
			files.forEach((file) => {
				let pos = file.split(': lockable: ');
				if (pos && pos.length === 2) {
					file = pos[0];
					status = pos[1];
					if (file && status === 'set') {
						parsedFiles.push(path.normalize(file.trim()));
					}
				}
			});

			cb(null, parsedFiles);
		} else {
			cb(null, parsedFiles);
		}
	});
};

function getLfsLocks(dir, cb) {
	exec('git lfs locks', {
		maxBuffer: (1024 * 1024) * 10, //10MB
		cwd: dir
	},
	(error, stdout, stderr) => {
		if (error) {
			cb(error);
			return;
		}

		let parsedFiles = [];
		if (stdout) {
			let files = stdout.split('\n');
			files.forEach((file) => {
				if (file) {
					let fileName = path.normalize(file.split('\t')[0].trim());
					let lockedBy = file.split('\t')[1].trim();
					let id = file.split('ID:')[1].trim();
					parsedFiles.push({
						file: fileName,
						lockedBy: lockedBy,
						id: id
					});
				}
			});

			cb(null, parsedFiles);
		} else {
			cb(null, parsedFiles);
		}
	});
};

function getArrayObjectByKey(array, key, value, defaultKeyValue) {
	let o = array.filter((e) => {
		return e[key] === value;
	});
	if (o.length > 0) {
		return defaultKeyValue ? o[0][defaultKeyValue] : o[0];
	}
	return undefined;
};

function loadRepoPage() {
    try { var branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir }).toString(); }
    catch (e) { console.error('Error occured', e); }
    win.webContents.send('repoDir', repoDir, branch);

	getLfsFileList(repoDir, (err, files) => {
		if (err) {
			console.error(err);

			win.webContents.send('isNoGitLfsRepo', repoDir);
			return;
		}
		getLfsLocks(repoDir, (err, lockedFiles) => {
			if (err) {
				console.error(err);

				win.webContents.send('isNoGitLfsRepo', repoDir);
				return;
			}
			let allFiles = [];
			let repoDirWithoutRoot = repoDir === repoRootDir ? '' : repoDir.replace(path.normalize(repoRootDir + '/'), '');

			files.forEach((file) => {
				const t = {
					file: file,
					lockedBy: getArrayObjectByKey(lockedFiles, 'file', path.normalize(repoDirWithoutRoot ? repoDirWithoutRoot + '/' + file : file), 'lockedBy'),
					id: getArrayObjectByKey(lockedFiles, 'file', path.normalize(repoDirWithoutRoot ? repoDirWithoutRoot + '/' + file : file), 'id')
				};

				allFiles.push(t);
			});
			win.webContents.send('fileList', allFiles);
		});
	});
	
	
};

function createWindow() {
	// Create the browser window.
	win = new BrowserWindow({
		title: 'gitlit v' + app.getVersion(),
		width: 1100,
		height: 700,
		webPreferences: {
			nodeIntegration: true,
			enableRemoteModule: true
		}
	});
	win.setMenu(null);

	// and load the index.html of the app.
	win.loadURL(url.format({
		pathname: path.join(__dirname, 'index.html'),
		protocol: 'file:',
		slashes: true
	}));

	electronLocalshortcut.register(win, 'F12', () => {
		win.webContents.toggleDevTools();
	});

	win.webContents.on('did-finish-load', () => {
		loadRepoPage();
	});
};

function startup(cb) {
	exec('git rev-parse --show-toplevel', {
		maxBuffer: (1024 * 1024) * 10, //10MB
		cwd: repoDir
	},
	(error, stdout, stderr) => {
		if (error) {
			if (win) {
				win.webContents.send('isNoGitLfsRepo', repoDir);
			}
			console.error(error);
		}

		if (stdout) {
			repoRootDir = path.normalize(stdout.replace(/\n/g, ''));
		}

		if (cb) {
			cb();
		}
	});
};

ipcMain.on('unlock', (event, file) => {
    try {
        execSync('git fetch', { cwd: repoDir });
        const raw_commits = execSync('git log --oneline @{upstream}..@ "'+file+'"', { cwd: repoDir }).toString();
        if (raw_commits)
        {
            if (dialog.showMessageBoxSync(win, {
                message: `Local commits not pushed to upstream branch!\n\nYour changes might get overwritten if they are not visible to other developers.`,
                type: "warning",
                buttons: ["Unlock anyway!", "Cancel"],
                defaultId: 1,
                noLink: true,
                title: "Unpushed commits!",
                cancelId: 1,
            }))
            {
                return 1; //user clicked "cancel" -> exit function here without unlocking the file
            }
        }
    } catch (e) {
        console.error('Error occured', e);
        let notification = {
            message: "Checking upstream branch for unpushed commits failed.\nSee console for details.\nUnlocking file now.",
            type: 'error'
        };
        win.webContents.send('notification', notification);
    }
    //no issues exist or user clicked "yes" -> continue unlocking file
    exec('git lfs unlock "'+file+'"', { cwd: repoDir },
        (error, stdout, stderr) => {
            let notification = {
                message: (error && error.message) || stderr,
                type: 'error'
            };
            if (stdout) {
                notification = {
                    file: file,
                    event: 'unlock',
                    type: 'info'
                };
            }
            win.webContents.send('notification', notification);
        }
    );
});

ipcMain.on('lock', (event, file) => {
    try {
        execSync('git fetch --all', { cwd: repoDir });
        const last_commit = execSync('git log -1 --format=%ct', { cwd: repoDir }).toString();
        const raw_commits = execSync('git log --oneline @.. --all --after='+last_commit+' "'+file+'"', { cwd: repoDir }).toString();
        if (raw_commits)
        {
            const formatted_commits = execSync('git log --pretty=format:"%h (%an %cr) %s" @.. --all --after='+last_commit+' "'+file+'"', { cwd: repoDir }).toString();
            if (dialog.showMessageBoxSync(win, {
                message: `The following commits changed this file since your last commit, but are not present in your branch:\n\n`
                            + formatted_commits +
                         `\n\nConsider merging the latest version into your current branch before applying changes. Otherwise your or the other developer's changes to the file might get lost in a merge conflict later.`,
                type: "warning",
                buttons: ["Lock anyway!", "Cancel"],
                defaultId: 1,
                noLink: true,
                title: "Unmerged changes!",
                cancelId: 1,
            }))
            {
                return 1; //user clicked "cancel" -> exit function here without locking the file
            }
        }
    } catch (e) {
        console.error('Error occured', e);
        let notification = {
            message: "Checking remote for unmerged commits failed.\nSee console for details.\nLocking file now.",
            type: 'error'
        };
        win.webContents.send('notification', notification);
    }
    lockFile(file); //no issues exist or user clicked "yes" -> continue locking file
});

ipcMain.on('restart', (event, newRepoDir) => {
	repoDir = newRepoDir;
	startup(loadRepoPage);
});

app.on('ready', () => {
	startup(createWindow);
});
