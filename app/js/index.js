(function($) {
	const ipcRenderer = require('electron').ipcRenderer;
	const remote = require('electron').remote;
	const electronFind = require('electron-find');
	const dialog = remote.require('electron').dialog;
	const shell = require('electron').shell;

	let findInPage = new electronFind.FindInPage(remote.getCurrentWebContents());

	let firstRun = true;

    var trs;

	//events

	//update stuff
	ipcRenderer.on('update', (event, state) => {
		if (state.event === 'updateAvailable') {
			$('.js-updatenotice').text(`New version ${state.version} available. Click here to download.`);
			$('.js-updatenotice').show();
			$('.js-updatenotice').prop('disabled', false);
			$('.js-updatenotice').prop('state', 'ready-to-download');
			$('.js-updatenotice').data('asset', state.asset);
		}

		if (state.event === 'updateReadyToInstall') {
			$('.js-updatenotice').text(`New version ready to install. Click here to start installer.`);
			$('.js-updatenotice').show();
			$('.js-updatenotice').prop('disabled', false);
			$('.js-updatenotice').prop('state', 'ready-to-install');
			$('.js-updatenotice').data('file', state.file);
		}
	});

	$(document).on('click', '.js-updatenotice', (ev) => {
		ev.preventDefault();
		if ($('.js-updatenotice').prop('disabled')) {
			return;
		}

		if ($('.js-updatenotice').prop('state') === 'ready-to-download') {
			$('.js-updatenotice').prop('disabled', true);
			$('.js-updatenotice').text(`Downloading new version...`);
			ipcRenderer.send('downloadUpdate', $('.js-updatenotice').data('asset'));
		} else if ($('.js-updatenotice').prop('state') === 'ready-to-install') {
			$('.js-updatenotice').prop('disabled', true);
			$('.js-updatenotice').text(`Launching installer...`);
			ipcRenderer.send('installUpdate', $('.js-updatenotice').data('file'));
		}
	});
	//end update stuff


	ipcRenderer.on('fileList', (event, files) => {
		firstRun = false;
		if (files && files.length > 0) {
			ejs.preloadTemplate('templates/files.ejs')
			.then(t => {
				$('.files-table-container').html(ejs.rr(t, {files: files}));
				sorttable.makeSortable($('.js-filestable')[0]);
				var myTH = document.getElementsByTagName('th')[0];
				sorttable.innerSortFunction.apply(myTH, []);
			});
		} else {
			$('.files-table-container').html(ejs.rr('templates/noGitLfsFiles.ejs'));
		}
        trs = document.getElementsByClassName('js-select');
	});

	ipcRenderer.on('repoDir', (event, repoDir, branch) => {
		ejs.preloadTemplate('templates/main.ejs')
		.then(t => {
			$('.js-container').html(ejs.rr(t));
            $('.js-repo-dir').text('Current repo path: ' + repoDir +'\xa0\xa0\xa0\xa0Current branch: '+branch).show();
		});
	});

	ipcRenderer.on('isNoGitLfsRepo', (event, repoDir) => {
		if (firstRun) {
			firstRun = false;
			$('.js-container').html(ejs.rr('templates/firstRun.ejs', {repoDir: repoDir}));
		} else {
			$('.js-container').html(ejs.rr('templates/isNoGitLfsRepo.ejs', {repoDir: repoDir}));
		}
	});

	ipcRenderer.on('notification', (event, notification) => {
		if (notification.message) {
			var notice = PNotify.alert({
				text: notification.message,
				type: notification.type, // - Type of the notice. 'notice', 'info', 'success', or 'error'.
				delay: 5000,
				modules: {
					Buttons: {
						closerHover: true
					}
				}
			});

			notice.on('click', function() {
				notice.remove();
			});
		}

		if (notification.event && notification.event === 'unlock') {
			let file = notification.file.replace(/\\/g, '\\\\');
			$('[data-file="' + file + '"].js-unlock').hide();
			$('[data-file="' + file + '"].js-lock').show();
			let text = 'not locked';
			$('[data-file="' + file + '"]').parent().prev().text(text);
		}
		if (notification.event && notification.event === 'lock') {
			let file = notification.file.replace(/\\/g, '\\\\');
			$('[data-file="' + file + '"].js-lock').hide();
			$('[data-file="' + file + '"].js-unlock').show();
			let text = notification.data.owner.name + ' (id: ' + notification.data.id + ')';
			$('[data-file="' + file + '"]').parent().prev().text(text);
		}
	});

	$(document).on('click', '.js-lock', (ev) => {
		ev.preventDefault();
        ev.stopPropagation();
		let file = $(ev.currentTarget).attr('data-file');
		ipcRenderer.send('lock', file);
	});

	$(document).on('click', '.js-unlock', (ev) => {
		ev.preventDefault();
        ev.stopPropagation();
		let file = $(ev.currentTarget).attr('data-file');
		ipcRenderer.send('unlock', file);
	});

	$(document).on('click', '.js-lock-selected', (ev) => {
		ev.preventDefault();
        let all = $('.selected').find('.js-lock:visible')
        let files = [];
        for (const element of all) {
            files.push($(element).attr('data-file'));
        }
		ipcRenderer.send('lock-selected', files);
	});

	$(document).on('click', '.js-unlock-selected', (ev) => {
		ev.preventDefault();
        let all = $('.selected').find('.js-unlock:visible')
        let files = [];
        for (const element of all) {
            files.push($(element).attr('data-file'));
        }
		ipcRenderer.send('unlock-selected', files);
	});

	$(document).on('click', '.js-refresh', (ev) => {
		ev.preventDefault();
		window.location.reload(false);
	});

	$(document).on('click', '.js-open-folder', (ev) => {
		ev.preventDefault();

		dialog.showOpenDialog({
			properties: ['openDirectory']
		})
		.then((path) => {
			if (path && path.filePaths.length > 0) {
				ipcRenderer.send('restart', path.filePaths[0]);
			};
		});
	});

	$(document).on('click', 'a[href^="http"]', function(event) {
		event.preventDefault();
		shell.openExternal(this.href);
	});

	$(document).on('keypress', (ev) => {
		//ctrl + f
		if (ev.ctrlKey && ev.charCode == 6) {
			findInPage.openFindWindow();
		}

		//ctrl + r
		if (ev.ctrlKey && ev.keyCode == 18) {
			window.location.reload(false);
		}
	});

	$(document).on('drop', (ev) => {
		ev.preventDefault();
		ev.stopPropagation();

		if (ev.originalEvent.dataTransfer.files && ev.originalEvent.dataTransfer.files.length > 0) {
			ipcRenderer.send('restart', ev.originalEvent.dataTransfer.files[0].path);
		}
	});

	$(document).on('dragover', (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
	});

    var lastSelectedRow;

    document.onselectstart = function () {
        return false;
    }

    $(document).on('click', '.js-select', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        let currenttr = $(ev.currentTarget)[0];
        if (window.event.ctrlKey) {
            toggleRow(currenttr);
        }

        if (window.event.button === 0) {
            if (!window.event.ctrlKey && !window.event.shiftKey) {
                clearAll(currenttr);
                toggleRow(currenttr);
            }
            if (window.event.shiftKey) {
                selectRowsBetweenIndexes([lastSelectedRow.rowIndex, currenttr.rowIndex])
            }
        }
    });

    function toggleRow(row) {
        if ($(row).hasClass('selected')) { $(row).removeClass('selected'); }
        else { $(row).addClass('selected'); }
        lastSelectedRow = row;
    }

    function selectRowsBetweenIndexes(indexes) {
        indexes.sort(function (a, b) { return a - b; });
        for (var i = indexes[0]; i <= indexes[1]; i++) {
            if (!$(trs[i-1]).hasClass('selected')) { $(trs[i-1]).addClass('selected') };
        }
    }

    function clearAll(currenttr) {
        for (var i = 0; i < trs.length; i++) {
            if (trs[i].rowIndex != currenttr.rowIndex) { $(trs[i]).removeClass('selected') };
        }
    }

	//startup
	PNotify.defaults.styling = 'bootstrap4'; // Bootstrap version 4

})(jQuery);