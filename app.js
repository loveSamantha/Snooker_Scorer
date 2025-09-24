class SnookerApp {
    constructor() {
        // 初始化数据库，确保在加载状态前建立连接
        this.initializeIndexedDB()
            .then(() => {
                // 尝试从 localStorage 恢复状态，如果没有则初始化新状态
                this.appState = this.loadStateFromLocalStorage() || this.initializeAppState();
                this.shotTimers = {
                    playerA: null,
                    playerB: null
                };
                this.historyStack = [];

                // 初始化UI后才开始恢复计时器
                this.initializeEventListeners();
                this.updateUI();

                // 立即显示正确的视图
                this.showView(this.appState.ui.view);

                // 恢复计时器状态（如果有球员正在出杆）
                if (this.appState.playerA.isShooting) {
                    this.startShotTimer('playerA');
                }
                if (this.appState.playerB.isShooting) {
                    this.startShotTimer('playerB');
                }
            })
            .catch(error => {
                console.error('初始化错误：', error);
                // 出错时也要确保应用可用
                this.appState = this.initializeAppState();
                this.initializeEventListeners();
                this.updateUI();
            });
    }

    initializeAppState() {
        return {
            currentMatchId: this.generateId(),
            playerA: {
                playerId: "playerA",
                name: "球员A",
                score: 0,
                remainingTime: 1200, // 20分钟
                isShooting: false,
                stats: {
                    totalShots: 0,
                    successfulShots: 0,
                    foulsCommitted: 0,
                    totalShotTime: 0
                }
            },
            playerB: {
                playerId: "playerB",
                name: "球员B",
                score: 0,
                remainingTime: 1200,
                isShooting: false,
                stats: {
                    totalShots: 0,
                    successfulShots: 0,
                    foulsCommitted: 0,
                    totalShotTime: 0
                }
            },
            activePlayerId: null,
            currentShot: null,
            currentBreakScore: 0,
            shotHistory: [],
            ui: {
                isBallSelectionVisible: false,
                view: "match"
            }
        };
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    initializeEventListeners() {
        // 球员A出杆按钮
        document.getElementById('shotButtonA').addEventListener('click', () => {
            this.handleShotButton('playerA');
        });

        // 球员B出杆按钮
        document.getElementById('shotButtonB').addEventListener('click', () => {
            this.handleShotButton('playerB');
        });

        // 进球按钮
        document.getElementById('potButton').addEventListener('click', () => {
            this.showBallSelection();
        });

        // 撤回按钮
        document.getElementById('undoButton').addEventListener('click', () => {
            this.handleUndo();
        });

        // 菜单按钮
        document.getElementById('menuButton').addEventListener('click', () => {
            this.showView('settingsView');
        });

        // 选球模态框
        this.initializeBallSelection();

        // 返回按钮
        document.querySelectorAll('.back-button').forEach(button => {
            button.addEventListener('click', () => {
                this.showView('matchView');
            });
        });

        // 新比赛按钮
        document.getElementById('newMatchButton').addEventListener('click', () => {
            this.startNewMatch();
        });

        // 比赛结束按钮
        document.getElementById('endMatchButton').addEventListener('click', () => {
            this.endCurrentMatch();
        });

        // 历史记录按钮
        document.getElementById('historyButton').addEventListener('click', () => {
            this.showView('historyListView');
        });

        // 添加窗口事件监听
        this.addWindowEventListeners();
    }

    initializeBallSelection() {
        const modal = document.getElementById('ballSelectionModal');
        const foulModal = document.getElementById('foulPointsModal');

        // 选球按钮
        document.querySelectorAll('.ball-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const ballType = e.target.dataset.ball;
                const points = parseInt(e.target.dataset.points);

                if (ballType === 'Foul') {
                    modal.classList.remove('active');
                    foulModal.classList.add('active');
                } else {
                    this.handlePotBall(ballType, points);
                    modal.classList.remove('active');
                }
            });
        });

        // 犯规分值按钮
        document.querySelectorAll('.foul-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const points = parseInt(e.target.dataset.points);
                this.handleFoul(points);
                foulModal.classList.remove('active');
            });
        });

        // 关闭模态框
        document.querySelectorAll('.close-modal').forEach(button => {
            button.addEventListener('click', () => {
                modal.classList.remove('active');
                foulModal.classList.remove('active');
            });
        });
    }

    handleShotButton(playerId) {
        this.saveStateToHistory();

        if (!this.appState[playerId].isShooting) {
            // 如果另一位球员正在出杆，停止他的出杆
            const otherPlayerId = playerId === 'playerA' ? 'playerB' : 'playerA';
            if (this.appState[otherPlayerId].isShooting) {
                this.endShot(otherPlayerId);
            }

            // 开始新一杆
            this.startShot(playerId);
        } else {
            // 结束当前杆
            this.endShot(playerId);
        }

        // 保存状态到 localStorage
        this.saveStateToLocalStorage();
    }

    startShot(playerId) {
        this.appState.activePlayerId = playerId;
        this.appState[playerId].isShooting = true;

        this.appState.currentShot = {
            shotId: this.generateId(),
            playerId: playerId,
            shotStartTime: new Date().toISOString(),
            shotEndTime: null,
            duration: 0,
            pottedBalls: [],
            isSuccess: false,
            isFoul: false
        };

        this.startShotTimer(playerId);
        this.updateUI();
    }

    endShot(playerId) {
        if (!this.appState.currentShot || this.appState.currentShot.playerId !== playerId) return;

        const currentShot = this.appState.currentShot;
        currentShot.shotEndTime = new Date().toISOString();
        currentShot.duration =
            (new Date(currentShot.shotEndTime) -
                new Date(currentShot.shotStartTime)) / 1000;

        // 扣除用时
        const player = this.appState[playerId];
        player.remainingTime -= currentShot.duration;
        player.remainingTime = Math.max(0, player.remainingTime);

        // 更新总出杆时间（用于计算平均时长）
        player.stats.totalShotTime += currentShot.duration;

        // 判断击球结果
        if (currentShot.pottedBalls.length > 0 && !currentShot.isFoul) {
            currentShot.isSuccess = true;
            player.stats.successfulShots++;
        }

        // 统计
        player.stats.totalShots++;

        // 添加到历史记录
        this.appState.shotHistory.push({ ...currentShot });

        // 重置状态
        this.appState[playerId].isShooting = false;
        this.appState.currentShot = null;

        this.stopShotTimer(playerId);
        this.updateUI();

        // 保存状态到 localStorage
        this.saveStateToLocalStorage();
    }

    startShotTimer(playerId) {
        console.log(`开始计时器 - ${playerId}`);

        // 确保先清除可能存在的旧计时器
        this.stopShotTimer(playerId);

        this.shotTimers[playerId] = setInterval(() => {
            console.log(`计时器触发 - ${playerId}`);

            if (!this.appState[playerId].isShooting) {
                console.log(`${playerId} 不在出杆状态，停止计时器`);
                this.stopShotTimer(playerId);
                return;
            }

            const player = this.appState[playerId];
            player.remainingTime = Math.max(0, player.remainingTime - 1);
            console.log(`${playerId} 剩余时间: ${player.remainingTime}`);

            this.updateUI();

            if (player.remainingTime <= 0) {
                this.handleTimeUp(playerId);
            }
        }, 1000);

        console.log(`计时器已创建 - ${playerId}: ${this.shotTimers[playerId] ? '成功' : '失败'}`);
    }

    stopShotTimer(playerId) {
        if (this.shotTimers[playerId]) {
            clearInterval(this.shotTimers[playerId]);
            this.shotTimers[playerId] = null;
        }
    }

    handleTimeUp(playerId) {
        alert(`${this.appState[playerId].name} 时间用完！`);
        this.endShot(playerId);
        // 这里可以添加比赛结束逻辑
    }

    showBallSelection() {
        document.getElementById('ballSelectionModal').classList.add('active');
    }

    handlePotBall(ballType, points) {
        if (!this.appState.currentShot) return;

        this.saveStateToHistory();

        const pottedBall = { ballType, points };
        this.appState.currentShot.pottedBalls.push(pottedBall);

        // 加分到当前球员
        const playerId = this.appState.currentShot.playerId;
        this.appState[playerId].score += points;
        this.appState.currentBreakScore += points;

        this.updateUI();

        // 保存状态到 localStorage
        this.saveStateToLocalStorage();
    }

    handleFoul(points) {
        if (!this.appState.currentShot) return;

        this.saveStateToHistory();

        const pottedBall = { ballType: "Foul", points };
        this.appState.currentShot.pottedBalls.push(pottedBall);
        this.appState.currentShot.isFoul = true;

        // 当前球员的对手得分
        const currentPlayerId = this.appState.currentShot.playerId;
        const opponentId = currentPlayerId === "playerA" ? "playerB" : "playerA";
        this.appState[opponentId].score += points;

        // 犯规统计
        this.appState[currentPlayerId].stats.foulsCommitted++;

        this.updateUI();

        // 保存状态到 localStorage
        this.saveStateToLocalStorage();
    }

    handleUndo() {
        if (this.historyStack.length > 0) {
            // 停止所有计时器
            this.stopShotTimer('playerA');
            this.stopShotTimer('playerB');

            // 恢复上一个状态
            this.appState = this.historyStack.pop();
            this.updateUI();

            // 根据恢复的状态决定是否需要重新启动计时器
            if (this.appState.playerA.isShooting) {
                this.startShotTimer('playerA');
            }
            if (this.appState.playerB.isShooting) {
                this.startShotTimer('playerB');
            }

            // 保存状态到 localStorage
            this.saveStateToLocalStorage();
        }
    }

    saveStateToHistory() {
        // 深拷贝当前状态
        const stateCopy = JSON.parse(JSON.stringify(this.appState));
        this.historyStack.push(stateCopy);

        // 限制历史记录大小
        if (this.historyStack.length > 20) {
            this.historyStack.shift();
        }
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    calculateHitRate(player) {
        if (player.stats.totalShots === 0) return 0;
        return Math.round((player.stats.successfulShots / player.stats.totalShots) * 100);
    }

    calculateAvgShotTime(player) {
        if (player.stats.totalShots === 0) return 0;
        return (player.stats.totalShotTime / player.stats.totalShots).toFixed(1);
    }

    updateUI() {
        // 更新球员面板
        this.updatePlayerPanel('playerA', this.appState.playerA);
        this.updatePlayerPanel('playerB', this.appState.playerB);

        // 更新控制按钮
        this.updateControlButtons();
    }

    updatePlayerPanel(playerId, playerState) {
        const panel = document.getElementById(playerId);
        const nameElement = panel.querySelector('.player-name');
        const scoreElement = panel.querySelector('.player-score');
        const timeElement = panel.querySelector('.remaining-time');
        const hitRateElement = panel.querySelector('.hit-rate');
        const avgTimeElement = panel.querySelector('.avg-shot-time');
        const breakScoreElement = panel.querySelector('.break-score');
        const shotHistoryElement = panel.querySelector('.player-shot-history');

        nameElement.textContent = playerState.name;
        scoreElement.textContent = playerState.score;
        timeElement.textContent = this.formatTime(Math.floor(playerState.remainingTime));
        hitRateElement.textContent = `命中率: ${this.calculateHitRate(playerState)}%`;
        avgTimeElement.textContent = `平均用时: ${this.calculateAvgShotTime(playerState)}秒`;

        // 显示单杆得分
        breakScoreElement.textContent = `单杆: ${playerState.isShooting ? this.appState.currentBreakScore : 0
            }`;

        // 时间警告
        if (playerState.remainingTime <= 60) {
            timeElement.classList.add('warning');
        } else {
            timeElement.classList.remove('warning');
        }

        // 更新该球员的击球记录
        this.updatePlayerShotHistory(playerId, shotHistoryElement);

        // 高亮当前出杆球员
        panel.classList.toggle('shooting', playerState.isShooting);
    }

    updatePlayerShotHistory(playerId, element) {
        // 获取该球员的最近5杆记录
        const playerShots = this.appState.shotHistory
            .filter(shot => shot.playerId === playerId)
            .slice(-5)
            .reverse();

        element.innerHTML = playerShots.map(shot => {
            const ballsText = shot.pottedBalls.map(ball =>
                `${ball.ballType}(${ball.points})`).join(', ') || '未进球';

            return `
                <div class="shot-history-item">
                    ${ballsText} | ${shot.duration.toFixed(1)}s
                </div>
            `;
        }).join('');

        if (playerShots.length === 0) {
            element.innerHTML = '<div class="shot-history-item">暂无击球记录</div>';
        }
    }

    updateControlButtons() {
        const shotButtonA = document.getElementById('shotButtonA');
        const shotButtonB = document.getElementById('shotButtonB');
        const potButton = document.getElementById('potButton');

        // 更新球员A的出杆按钮
        shotButtonA.textContent = this.appState.playerA.isShooting ? '停止' : '出杆';
        shotButtonA.classList.toggle('timing', this.appState.playerA.isShooting);

        // 更新球员B的出杆按钮
        shotButtonB.textContent = this.appState.playerB.isShooting ? '停止' : '出杆';
        shotButtonB.classList.toggle('timing', this.appState.playerB.isShooting);

        // 进球按钮只有当有球员在出杆时才能使用
        const isAnyShooting = this.appState.playerA.isShooting || this.appState.playerB.isShooting;
        potButton.disabled = !isAnyShooting;
    }

    showView(viewId) {
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });
        document.getElementById(viewId).classList.add('active');
        this.appState.ui.view = viewId;

        if (viewId === 'historyListView') {
            this.loadHistoryList();
        }
    }

    startNewMatch() {
        const playerAName = document.getElementById('playerAName').value;
        const playerBName = document.getElementById('playerBName').value;
        const totalTime = parseInt(document.getElementById('totalTime').value) * 60;

        // 保存当前比赛
        if (this.appState.shotHistory.length > 0) {
            this.saveMatch();
        }

        // 重置状态
        this.appState = this.initializeAppState();
        this.appState.playerA.name = playerAName;
        this.appState.playerB.name = playerBName;
        this.appState.playerA.remainingTime = totalTime;
        this.appState.playerB.remainingTime = totalTime;
        this.historyStack = [];

        // 清除 localStorage 中的旧状态并保存新状态
        this.saveStateToLocalStorage();

        this.showView('matchView');
        this.updateUI();
    }

    // IndexedDB 相关方法
    async initializeIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('SnookerDB', 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('matches')) {
                    db.createObjectStore('matches', { keyPath: 'matchId' });
                }
            };
        });
    }

    async saveMatch() {
        if (!this.db) {
            console.error('数据库未初始化，无法保存比赛');
            return;
        }

        const match = {
            matchId: this.appState.currentMatchId,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            settings: {
                totalTimePerPlayer: Math.max(
                    this.appState.playerA.remainingTime,
                    this.appState.playerB.remainingTime
                )
            },
            players: [
                { playerId: "playerA", name: this.appState.playerA.name },
                { playerId: "playerB", name: this.appState.playerB.name }
            ],
            shotHistory: this.appState.shotHistory,
            finalScores: {
                playerA: this.appState.playerA.score,
                playerB: this.appState.playerB.score
            },
            winnerId: this.appState.playerA.score > this.appState.playerB.score ?
                "playerA" : (this.appState.playerB.score > this.appState.playerA.score ? "playerB" : "tie")
        };

        try {
            const transaction = this.db.transaction(['matches'], 'readwrite');
            const store = transaction.objectStore('matches');
            await store.put(match);
            console.log('比赛记录已保存');
            return true;
        } catch (error) {
            console.error('保存比赛记录失败：', error);
            return false;
        }
    }

    async loadHistoryList() {
        if (!this.db) return;

        const transaction = this.db.transaction(['matches'], 'readonly');
        const store = transaction.objectStore('matches');
        const request = store.getAll();

        request.onsuccess = () => {
            const matches = request.result;
            this.displayHistoryList(matches);
        };
    }

    displayHistoryList(matches) {
        const historyList = document.getElementById('historyList');

        if (matches.length === 0) {
            historyList.innerHTML = '<p>暂无历史比赛记录</p>';
            return;
        }

        historyList.innerHTML = matches.reverse().map(match => `
            <div class="history-item" onclick="app.showMatchDetail('${match.matchId}')">
                <div class="history-date">${new Date(match.endTime).toLocaleDateString()}</div>
                <div class="history-players">${match.players[0].name} vs ${match.players[1].name}</div>
                <div class="history-score">${match.finalScores.playerA} - ${match.finalScores.playerB}</div>
            </div>
        `).join('');
    }

    async showMatchDetail(matchId) {
        if (!this.db) return;

        const transaction = this.db.transaction(['matches'], 'readonly');
        const store = transaction.objectStore('matches');
        const request = store.get(matchId);

        request.onsuccess = () => {
            const match = request.result;
            if (match) {
                this.displayMatchDetail(match);
                this.showView('matchDetailView');
            }
        };
    }

    displayMatchDetail(match) {
        const detailElement = document.getElementById('matchDetail');

        // 处理平局情况
        const winnerName = match.winnerId === 'tie' ?
            '平局' :
            match.winnerId === 'playerA' ? match.players[0].name : match.players[1].name;

        detailElement.innerHTML = `
            <div class="match-summary">
                <h3>${match.players[0].name} vs ${match.players[1].name}</h3>
                <div class="final-score">
                    <span>${match.finalScores.playerA} - ${match.finalScores.playerB}</span>
                </div>
                <p>比赛时间: ${new Date(match.endTime).toLocaleString()}</p>
                <p>比赛结果: ${winnerName}</p>
            </div>
            <div class="shot-detail">
                <h4>击球记录 (${match.shotHistory.length} 杆)</h4>
                <div class="shot-list">
                    ${match.shotHistory.map((shot, index) => {
            const player = match.players.find(p => p.playerId === shot.playerId);
            const ballsText = shot.pottedBalls.map(ball =>
                `${ball.ballType}(${ball.points})`).join(', ') || '未进球';

            return `
                            <div class="shot-item">
                                <span class="shot-number">${index + 1}.</span>
                                <span class="shot-player">${player.name}</span>
                                <span class="shot-balls">${ballsText}</span>
                                <span class="shot-time">${shot.duration.toFixed(1)}s</span>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    // localStorage 相关方法
    saveStateToLocalStorage() {
        try {
            const stateToSave = {
                ...this.appState,
                // 添加保存时间戳
                lastSaved: new Date().toISOString()
            };
            localStorage.setItem('snookerAppState', JSON.stringify(stateToSave));
            console.log('应用状态已保存到 localStorage');
        } catch (error) {
            console.error('保存状态到 localStorage 失败:', error);
        }
    }

    loadStateFromLocalStorage() {
        try {
            const savedState = localStorage.getItem('snookerAppState');
            if (savedState) {
                const parsedState = JSON.parse(savedState);
                console.log('从 localStorage 加载了应用状态');
                return parsedState;
            }
        } catch (error) {
            console.error('从 localStorage 加载状态失败:', error);
        }
        return null;
    }

    clearLocalStorageState() {
        try {
            localStorage.removeItem('snookerAppState');
            console.log('已清除 localStorage 中的应用状态');
        } catch (error) {
            console.error('清除 localStorage 状态失败:', error);
        }
    }

    // 添加未实现的方法
    addWindowEventListeners() {
        window.addEventListener('beforeunload', () => {
            // 如果有球员正在出杆，保存状态
            if (this.appState.playerA.isShooting || this.appState.playerB.isShooting) {
                this.saveStateToLocalStorage();
            }
        });
    }

    // 修改endCurrentMatch方法，确保正确实现
    endCurrentMatch() {
        if (this.appState.shotHistory.length === 0) {
            alert('没有记录到任何击球，无法结束比赛。');
            return;
        }

        // 停止可能正在进行的出杆
        if (this.appState.playerA.isShooting) {
            this.endShot('playerA');
        }
        if (this.appState.playerB.isShooting) {
            this.endShot('playerB');
        }

        // 计算胜者
        const winnerId = this.appState.playerA.score > this.appState.playerB.score ? 'playerA' :
            this.appState.playerB.score > this.appState.playerA.score ? 'playerB' : 'tie';

        // 提示用户
        const winnerName = winnerId === 'tie' ? '平局' : this.appState[winnerId].name;
        const scoreA = this.appState.playerA.score;
        const scoreB = this.appState.playerB.score;
        const message = winnerId === 'tie' ?
            `比赛结束，比分 ${scoreA}-${scoreB}，平局！` :
            `比赛结束，比分 ${scoreA}-${scoreB}，${winnerName} 获胜！`;

        if (confirm(message + '\n\n是否保存此比赛记录？')) {
            this.saveMatch();

            // 清除当前比赛状态
            this.appState = this.initializeAppState();
            this.historyStack = [];
            this.saveStateToLocalStorage();
            this.updateUI();

            // 显示历史记录
            this.showView('historyListView');
        }
    }
}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new SnookerApp();
});
