const {app, BrowserWindow, dialog, ipcMain} = require('electron');
const path = require('path');
const url = require('url');
const electronLocalshortcut = require('electron-localshortcut');
const exec = require('child_process').exec;
const gau = require('github-app-updater');
const args = require('minimist')(process.defaultApp ? process.argv.slice(3) : process.argv.slice(1), {
	default: {
		_: process.cwd()
	}
});

let win;
let repoDir = path.resolve(path.normalize(args._.join(' ')));
let repoRootDir = repoDir;
var branch = '';

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

function getRepoBranches(dir, cb) {
	exec('git branch -r | findstr /v "HEAD"', {
			maxBuffer: (1024 * 1024) * 10, //10MB
			cwd: dir
		},
		(error, stdout, stderr) => {
			if (error) {
				cb(error);
				return;
			}
			let branches = [];
			if (stdout) {
				stdout.split('\n').forEach((abranch) => {
					if (abranch.length > 0) { branches.push(abranch.trim()); }
				});
				branch = '';
				let defaultBranch = '';
				if (branches.indexOf("origin/main") > -1) { branch = "origin/main"; defaultBranch = "origin/main"; }
				if (branches.indexOf("origin/master") > -1) { branch = "origin/master"; defaultBranch = "origin/master"; }
				if (branches.indexOf("origin/develop") > -1) { branch = "origin/develop"; defaultBranch = "origin/develop"; }
				
				cb(null, branches, defaultBranch);
			} else {
				defaultBranch = '';
				cb(null, branches, defaultBranch);
			}
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
	win.webContents.send('repoDir', repoDir);

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
			
			getRepoBranches(repoDir, (err, branches, defaultBranch) => {
				if (err) {
					console.error(err);
					return;
				}
				win.webContents.send('fileList', allFiles, branches, defaultBranch);
			});
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
	exec('git lfs unlock "' + file + '"', {
		maxBuffer: (1024 * 1024) * 10, //10MB
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
				event: 'unlock',
				type: 'info'
			};
		}

		win.webContents.send('notification', notification);
	});
});

ipcMain.on('lock', (event, file) => {
	var child = exec('git remote update');
	//if above command succeeds:
	child.stdout.on('data', (data) => {
		exec('git log --oneline --exit-code ..remotes/' + branch + ' "' + file + '"', 
			{ 	maxBuffer: (1024 * 1024) * 10, //10MB
				cwd: repoDir
			},
			(error, stdout, stderr) => {
				//if changes to the file exist in upstream branch:
				if (stdout) {
					//open pop-up warning
					if (dialog.showMessageBoxSync(win, {
						message: 	`A newer version of this file was pushed to branch ` + branch + `.\n
									Consider merging the newest version into your current branch before applying changes.
									Otherwise your or the other developer's changes to the file might get lost in a merge conflict later.`,
						type: "warning",
						buttons: ["Lock anyway!", "Cancel"],
						defaultId: 1,
						noLink: true,
						title: "Unmerged changes!",
						cancelId: 1,
					})) 
					{
						//if "cancel" -> exit function
						return 1;
					}
					else
					{
						//if "yes" -> continue locking file
						lockFile(file);
						return 0;
					}
				}
				//in case there was an error (e.g., no develop branch found), show a notification
				if ((error && error.message) || stderr) {
					let notification = {
						message: "Apparently, I can't find the specified upstream branch to check for newer files...\n\n" + (error && error.message) || stderr,
						type: 'error'
					};
					win.webContents.send('notification', notification);	
				}
				//and then lock the file as if there was no check
				lockFile(file);
			}
		);
	});	
});

ipcMain.on('selectBranch', (event, thisbranch) => {
	branch = thisbranch;
});

ipcMain.on('restart', (event, newRepoDir) => {
	repoDir = newRepoDir;
	startup(loadRepoPage);
});

app.on('ready', () => {
	startup(createWindow);
});
