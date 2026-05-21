

const FlagFootballTracker = () => {
  
  // localStorage wrapper to match window.storage API
  if (typeof window !== 'undefined' && !window.storage && window.localStorage) {
    window.storage = {
      get: async (key) => {
        const value = localStorage.getItem(key);
        return value ? { key, value, shared: false } : null;
      },
      set: async (key, value) => {
        localStorage.setItem(key, value);
        return { key, value, shared: false };
      },
      delete: async (key) => {
        localStorage.removeItem(key);
        return { key, deleted: true, shared: false };
      },
      list: async (prefix) => {
        const keys = Object.keys(localStorage).filter(k => !prefix || k.startsWith(prefix));
        return { keys, prefix, shared: false };
      }
    };
  }
  
  // All state
  const [games, setGames] = React.useState([]);
  const [currentGame, setCurrentGame] = React.useState(null);
  const [view, setView] = React.useState('home');
  const [seasonStats, setSeasonStats] = React.useState({
    playerStats: {},
    teamStats: { gamesPlayed: 0, wins: 0, losses: 0, ties: 0, totalPointsFor: 0, totalPointsAgainst: 0 },
    gameIds: []
  });
  const [teamRoster, setTeamRoster] = React.useState([]);
  const [teamName, setTeamName] = React.useState('');
  const [storageAvailable, setStorageAvailable] = React.useState(true);

  // Setup view state
  const [setupTeamName, setSetupTeamName] = React.useState('');
  const [setupOpponentName, setSetupOpponentName] = React.useState('');
  const [setupRoster, setSetupRoster] = React.useState([]);
  const [setupPlayerName, setSetupPlayerName] = React.useState('');
  const [setupPlayerNumber, setSetupPlayerNumber] = React.useState('');
  const [setupFirstPossession, setSetupFirstPossession] = React.useState('team');

  // Game view state
  const [gameMode, setGameMode] = React.useState('normal');
  const [playType, setPlayType] = React.useState('pass');
  const [yards, setYards] = React.useState(0);
  const [players, setPlayers] = React.useState({ passer: '', receiver: '', rusher: '', defender: '' });
  const [flags, setFlags] = React.useState({ complete: true, firstDown: false, touchdown: false, turnover: false, interception: false, flagPull: true, safety: false, passDeflection: false, incomplete: false });
  const [lastPasser, setLastPasser] = React.useState('');
  const [lastRusher, setLastRusher] = React.useState('');
  const [showSettings, setShowSettings] = React.useState(false);
  const [pointAfterType, setPointAfterType] = React.useState(1);
  const [pointAfterSuccess, setPointAfterSuccess] = React.useState(true);
  const [interceptionTD, setInterceptionTD] = React.useState(false);
  const [interceptionFieldPos, setInterceptionFieldPos] = React.useState(20);
  const [otConversionType, setOtConversionType] = React.useState(1);
  const [otConversionSuccess, setOtConversionSuccess] = React.useState(true);
  const [otPlayType, setOtPlayType] = React.useState('run');
  const [showEndHalfDialog, setShowEndHalfDialog] = React.useState(false);
  const [endHalfPossession, setEndHalfPossession] = React.useState('team');

  // Stats view state
  const [statsView, setStatsView] = React.useState('team');

  // Penalty state
  const [penaltyYards, setPenaltyYards] = React.useState(0);
  const [penaltyOnOffense, setPenaltyOnOffense] = React.useState(true);
  const [penaltyLossOfDown, setPenaltyLossOfDown] = React.useState(false);
  const [showUndoConfirm, setShowUndoConfirm] = React.useState(false);
  const [showImportDialog, setShowImportDialog] = React.useState(false);
  const [importData, setImportData] = React.useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [gameToDelete, setGameToDelete] = React.useState(null);
  const [endingGame, setEndingGame] = React.useState(false);

  // Initialize
  React.useEffect(() => {
    const init = async () => {
      if (typeof window === 'undefined' || !window.localStorage) {
        setStorageAvailable(false);
        return;
      }
      // Load team info
      try {
        const data = await localStorage.getItem('team_info');
        if (data?.value) {
          const info = JSON.parse(data.value);
          setTeamName(info.teamName || '');
          setTeamRoster(info.roster || []);
        }
      } catch (e) {}
      // Load season stats
      try {
        const data = await localStorage.getItem('season_stats');
        if (data?.value) setSeasonStats(JSON.parse(data.value));
      } catch (e) {}
      // Load games
      try {
        const result = await localStorage.keys('game:');
        if (result?.keys) {
          const loaded = await Promise.all(result.keys.map(async (key) => {
            try {
              const data = await localStorage.getItem(key);
              return data ? JSON.parse(data.value) : null;
            } catch (e) { return null; }
          }));
          setGames(loaded.filter(g => g).sort((a, b) => new Date(b.date) - new Date(a.date)));
        }
      } catch (e) {}
    };
    init();
  }, []);

  // Save functions
  const saveGame = async (game) => {
    if (window.localStorage) {
      try {
        await localStorage.setItem(`game:${game.id}`, JSON.stringify(game));
      } catch (e) {}
    }
    setGames(prev => {
      const filtered = prev.filter(g => g.id !== game.id);
      return [...filtered, game].sort((a, b) => new Date(b.date) - new Date(a.date));
    });
  };

  // Game functions (simplified)
  const createNewGame = () => {
    setCurrentGame({
      id: Date.now(),
      date: new Date().toISOString(),
      teamName: teamName || '',
      opponentName: '',
      roster: [...teamRoster],
      score: { team: 0, opponent: 0 },
      possession: 'team',
      half: 1,
      down: 1,
      yardsToGo: 12,
      lineOfScrimmage: 5,
      firstDownTarget: 17,
      plays: [],
      stats: {
        offense: { passAttempts: 0, completions: 0, passingYards: 0, rushAttempts: 0, rushingYards: 0, firstDowns: 0, touchdowns: 0 },
        defense: { flagPulls: 0, interceptions: 0 }
      },
      playerStats: {}
    });
    setSetupTeamName(teamName || '');
    setSetupOpponentName('');
    setSetupRoster([...teamRoster]);
    setSetupPlayerName('');
    setSetupPlayerNumber('');
    setSetupFirstPossession('team');
    setView('setup');
  };

  const startGame = () => {
    if (!setupTeamName || !setupOpponentName || setupRoster.length === 0) {
      alert('Please enter team names and add at least one player.');
      return;
    }
    const updatedGame = { ...currentGame, teamName: setupTeamName, opponentName: setupOpponentName, roster: setupRoster, possession: setupFirstPossession };
    if (setupTeamName !== teamName || JSON.stringify(setupRoster) !== JSON.stringify(teamRoster)) {
      if (window.localStorage) {
        try {
          localStorage.setItem('team_info', JSON.stringify({ teamName: setupTeamName, roster: setupRoster }));
        } catch (e) {}
      }
      setTeamName(setupTeamName);
      setTeamRoster(setupRoster);
    }
    const playerStats = {};
    setupRoster.forEach(player => {
      playerStats[player.id] = { name: player.name, number: player.number, offense: { passAttempts: 0, completions: 0, incompletions: 0, passingYards: 0, interceptions: 0, rushAttempts: 0, rushingYards: 0, receptions: 0, receivingYards: 0, touchdowns: 0 }, defense: { flagPulls: 0, interceptions: 0, tacklesForLoss: 0, passDeflections: 0 } };
    });
    updatedGame.playerStats = playerStats;
    setCurrentGame(updatedGame);
    saveGame(updatedGame);
    setView('game');
  };

  const deleteGame = async (gameId) => {
    setGameToDelete(gameId);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteGame = async () => {
    if (!gameToDelete) return;
    
    const game = games.find(g => g.id === gameToDelete);
    
    // If game was completed, subtract its stats from season
    if (game && game.completed) {
      try {
        const newSeasonStats = { ...seasonStats };
        
        // Subtract from record
        if (game.result === 'win') newSeasonStats.teamStats.wins = Math.max(0, (newSeasonStats.teamStats.wins || 0) - 1);
        else if (game.result === 'loss') newSeasonStats.teamStats.losses = Math.max(0, (newSeasonStats.teamStats.losses || 0) - 1);
        else if (game.result === 'tie') newSeasonStats.teamStats.ties = Math.max(0, (newSeasonStats.teamStats.ties || 0) - 1);
        
        newSeasonStats.teamStats.gamesPlayed = Math.max(0, (newSeasonStats.teamStats.gamesPlayed || 0) - 1);
        newSeasonStats.teamStats.totalPointsFor = Math.max(0, (newSeasonStats.teamStats.totalPointsFor || 0) - game.score.team);
        newSeasonStats.teamStats.totalPointsAgainst = Math.max(0, (newSeasonStats.teamStats.totalPointsAgainst || 0) - game.score.opponent);
        
        // Subtract offense stats
        if (newSeasonStats.teamStats.offense) {
          newSeasonStats.teamStats.offense.passAttempts = Math.max(0, newSeasonStats.teamStats.offense.passAttempts - game.stats.offense.passAttempts);
          newSeasonStats.teamStats.offense.completions = Math.max(0, newSeasonStats.teamStats.offense.completions - game.stats.offense.completions);
          newSeasonStats.teamStats.offense.passingYards = Math.max(0, newSeasonStats.teamStats.offense.passingYards - game.stats.offense.passingYards);
          newSeasonStats.teamStats.offense.rushAttempts = Math.max(0, newSeasonStats.teamStats.offense.rushAttempts - game.stats.offense.rushAttempts);
          newSeasonStats.teamStats.offense.rushingYards = Math.max(0, newSeasonStats.teamStats.offense.rushingYards - game.stats.offense.rushingYards);
          newSeasonStats.teamStats.offense.firstDowns = Math.max(0, newSeasonStats.teamStats.offense.firstDowns - game.stats.offense.firstDowns);
          newSeasonStats.teamStats.offense.touchdowns = Math.max(0, newSeasonStats.teamStats.offense.touchdowns - game.stats.offense.touchdowns);
          newSeasonStats.teamStats.offense.totalPlays = Math.max(0, newSeasonStats.teamStats.offense.totalPlays - game.stats.offense.totalPlays);
        }
        
        // Subtract defense stats
        if (newSeasonStats.teamStats.defense) {
          newSeasonStats.teamStats.defense.flagPulls = Math.max(0, newSeasonStats.teamStats.defense.flagPulls - game.stats.defense.flagPulls);
          newSeasonStats.teamStats.defense.interceptions = Math.max(0, newSeasonStats.teamStats.defense.interceptions - game.stats.defense.interceptions);
          newSeasonStats.teamStats.defense.forcedPunts = Math.max(0, (newSeasonStats.teamStats.defense.forcedPunts || 0) - (game.stats.defense.forcedPunts || 0));
          newSeasonStats.teamStats.defense.turnoversOnDowns = Math.max(0, (newSeasonStats.teamStats.defense.turnoversOnDowns || 0) - (game.stats.defense.turnoversOnDowns || 0));
        }
        
        // Subtract player stats
        Object.entries(game.playerStats || {}).forEach(([playerId, stats]) => {
          if (newSeasonStats.playerStats && newSeasonStats.playerStats[playerId]) {
            const p = newSeasonStats.playerStats[playerId];
            p.offense.passAttempts = Math.max(0, p.offense.passAttempts - stats.offense.passAttempts);
            p.offense.completions = Math.max(0, p.offense.completions - stats.offense.completions);
            p.offense.passingYards = Math.max(0, p.offense.passingYards - stats.offense.passingYards);
            p.offense.rushAttempts = Math.max(0, p.offense.rushAttempts - stats.offense.rushAttempts);
            p.offense.rushingYards = Math.max(0, p.offense.rushingYards - stats.offense.rushingYards);
            p.offense.receptions = Math.max(0, p.offense.receptions - stats.offense.receptions);
            p.offense.receivingYards = Math.max(0, p.offense.receivingYards - stats.offense.receivingYards);
            p.offense.touchdowns = Math.max(0, p.offense.touchdowns - stats.offense.touchdowns);
            p.defense.flagPulls = Math.max(0, p.defense.flagPulls - stats.defense.flagPulls);
            p.defense.interceptions = Math.max(0, p.defense.interceptions - stats.defense.interceptions);
            p.defense.tacklesForLoss = Math.max(0, (p.defense.tacklesForLoss || 0) - (stats.defense.tacklesForLoss || 0));
            p.defense.passDeflections = Math.max(0, (p.defense.passDeflections || 0) - (stats.defense.passDeflections || 0));
          }
        });
        
        setSeasonStats(newSeasonStats);
        if (window.localStorage) {
          await localStorage.setItem('season_stats', JSON.stringify(newSeasonStats));
        }
      } catch (error) {
        console.error('Error subtracting stats on delete:', error);
      }
    }
    
    // Delete the game
    if (window.localStorage) {
      try { await localStorage.removeItem(`game:${gameToDelete}`); } catch (e) {}
    }
    setGames(prev => prev.filter(g => g.id !== gameToDelete));
    
    setShowDeleteConfirm(false);
    setGameToDelete(null);
  };

  const exportSeason = () => {
    const seasonData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      teamInfo: {
        teamName: teamName,
        roster: teamRoster
      },
      games: games,
      seasonStats: seasonStats
    };
    
    const json = JSON.stringify(seasonData, null, 2);
    
    // Try Share API first (works better on mobile)
    if (navigator.share) {
      const blob = new Blob([json], { type: 'application/json' });
      const file = new File([blob], `${teamName || 'season'}_export.json`, { type: 'application/json' });
      navigator.share({
        files: [file],
        title: 'Season Export',
        text: `Season data export for ${teamName}`
      }).catch(err => {
        // Fallback to data URL
        console.log('Share failed, using download:', err);
        const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `${teamName || 'season'}_export_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
      });
    } else {
      // Fallback to data URL
      const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${teamName || 'season'}_export_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
    }
  };

  const exportSeasonCSV = () => {
    let csv = `${teamName} Season Statistics\n\n`;
    csv += `Record,${seasonStats.teamStats.wins || 0}-${seasonStats.teamStats.losses || 0}${(seasonStats.teamStats.ties || 0) > 0 ? `-${seasonStats.teamStats.ties}` : ''}\n`;
    csv += `Games Played,${seasonStats.teamStats.gamesPlayed || 0}\n`;
    csv += `Points For,${seasonStats.teamStats.totalPointsFor || 0}\n`;
    csv += `Points Against,${seasonStats.teamStats.totalPointsAgainst || 0}\n\n`;
    
    // Team Offense
    if (seasonStats.teamStats.offense) {
      csv += 'TEAM OFFENSE\n';
      csv += `Total Plays,${seasonStats.teamStats.offense.totalPlays}\n`;
      csv += `First Downs,${seasonStats.teamStats.offense.firstDowns}\n`;
      csv += `Touchdowns,${seasonStats.teamStats.offense.touchdowns}\n`;
      csv += `Pass Attempts,${seasonStats.teamStats.offense.passAttempts}\n`;
      csv += `Completions,${seasonStats.teamStats.offense.completions}\n`;
      csv += `Passing Yards,${seasonStats.teamStats.offense.passingYards}\n`;
      csv += `Rush Attempts,${seasonStats.teamStats.offense.rushAttempts}\n`;
      csv += `Rushing Yards,${seasonStats.teamStats.offense.rushingYards}\n`;
      csv += `Total Yards,${seasonStats.teamStats.offense.passingYards + seasonStats.teamStats.offense.rushingYards}\n\n`;
    }
    
    // Team Defense
    if (seasonStats.teamStats.defense) {
      csv += 'TEAM DEFENSE\n';
      csv += `Flag Pulls,${seasonStats.teamStats.defense.flagPulls}\n`;
      csv += `Interceptions,${seasonStats.teamStats.defense.interceptions}\n`;
      csv += `Forced Punts,${seasonStats.teamStats.defense.forcedPunts || 0}\n`;
      csv += `Turnovers on Downs,${seasonStats.teamStats.defense.turnoversOnDowns || 0}\n\n`;
    }
    
    // Season Player Stats - Passing
    const passers = Object.values(seasonStats.playerStats || {}).filter(p => p.offense.passAttempts > 0);
    if (passers.length > 0) {
      csv += 'SEASON LEADERS - PASSING\n';
      csv += 'Player,CMP,ATT,YDS,TD,INT\n';
      passers.forEach(p => {
        csv += `#${p.number} ${p.name},${p.offense.completions},${p.offense.passAttempts},${p.offense.passingYards},${p.offense.touchdowns},${p.offense.interceptions}\n`;
      });
      csv += '\n';
    }
    
    // Season Player Stats - Rushing
    const rushers = Object.values(seasonStats.playerStats || {}).filter(p => p.offense.rushAttempts > 0);
    if (rushers.length > 0) {
      csv += 'SEASON LEADERS - RUSHING\n';
      csv += 'Player,ATT,YDS,TD\n';
      rushers.forEach(p => {
        csv += `#${p.number} ${p.name},${p.offense.rushAttempts},${p.offense.rushingYards},${p.offense.touchdowns}\n`;
      });
      csv += '\n';
    }
    
    // Season Player Stats - Receiving
    const receivers = Object.values(seasonStats.playerStats || {}).filter(p => p.offense.receptions > 0);
    if (receivers.length > 0) {
      csv += 'SEASON LEADERS - RECEIVING\n';
      csv += 'Player,REC,YDS,TD\n';
      receivers.forEach(p => {
        csv += `#${p.number} ${p.name},${p.offense.receptions},${p.offense.receivingYards},${p.offense.touchdowns}\n`;
      });
      csv += '\n';
    }
    
    // Season Player Stats - Defense
    const defenders = Object.values(seasonStats.playerStats || {}).filter(p => p.defense.flagPulls > 0 || p.defense.interceptions > 0 || p.defense.tacklesForLoss > 0 || p.defense.passDeflections > 0);
    if (defenders.length > 0) {
      csv += 'SEASON LEADERS - DEFENSE\n';
      csv += 'Player,Tackles,TFL,INT,PD\n';
      defenders.forEach(p => {
        csv += `#${p.number} ${p.name},${p.defense.flagPulls},${p.defense.tacklesForLoss || 0},${p.defense.interceptions},${p.defense.passDeflections || 0}\n`;
      });
    }
    
    // Try Share API first (works better on mobile)
    if (navigator.share) {
      const blob = new Blob([csv], { type: 'text/csv' });
      const file = new File([blob], `${teamName}_season_stats.csv`, { type: 'text/csv' });
      navigator.share({
        files: [file],
        title: 'Season Stats',
        text: `Season statistics for ${teamName}`
      }).catch(err => {
        // Fallback to data URL
        console.log('Share failed, using download:', err);
        const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `${teamName}_season_stats_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
      });
    } else {
      // Fallback to data URL
      const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${teamName}_season_stats_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
    }
  };

  const importSeason = async () => {
    try {
      const data = JSON.parse(importData);
      
      // Validate the data structure
      if (!data.version || !data.teamInfo || !data.games || !data.seasonStats) {
        alert('Invalid season data format!');
        return;
      }
      
      // Import team info
      setTeamName(data.teamInfo.teamName || '');
      setTeamRoster(data.teamInfo.roster || []);
      if (window.localStorage) {
        await localStorage.setItem('team_info', JSON.stringify(data.teamInfo));
      }
      
      // Import games
      if (window.localStorage) {
        for (const game of data.games) {
          await localStorage.setItem(`game:${game.id}`, JSON.stringify(game));
        }
      }
      setGames(data.games);
      
      // Import season stats
      setSeasonStats(data.seasonStats);
      if (window.localStorage) {
        await localStorage.setItem('season_stats', JSON.stringify(data.seasonStats));
      }
      
      setShowImportDialog(false);
      setImportData('');
      alert(`Season imported successfully! ${data.games.length} games loaded.`);
    } catch (error) {
      console.error('Import error:', error);
      alert('Error importing season. Please check the file format.');
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImportData(e.target.result);
      };
      reader.readAsText(file);
    }
  };

  const downloadCSV = (game) => {
    // Build comprehensive CSV with all stats
    let csv = 'Flag Football Game Stats\n\n';
    csv += `Date,${new Date(game.date).toLocaleDateString()}\n`;
    csv += `Teams,${game.teamName} vs ${game.opponentName}\n`;
    csv += `Final Score,${game.score.team} - ${game.score.opponent}\n\n`;
    
    // Team Stats - Offense
    csv += 'TEAM STATS - OFFENSE\n';
    csv += `Total Plays,${game.stats.offense.totalPlays}\n`;
    csv += `First Downs,${game.stats.offense.firstDowns}\n`;
    csv += `Touchdowns,${game.stats.offense.touchdowns}\n`;
    csv += `Pass Attempts,${game.stats.offense.passAttempts}\n`;
    csv += `Completions,${game.stats.offense.completions}\n`;
    csv += `Passing Yards,${game.stats.offense.passingYards}\n`;
    csv += `Rush Attempts,${game.stats.offense.rushAttempts}\n`;
    csv += `Rushing Yards,${game.stats.offense.rushingYards}\n`;
    csv += `Total Yards,${game.stats.offense.passingYards + game.stats.offense.rushingYards}\n\n`;
    
    // Team Stats - Defense
    csv += 'TEAM STATS - DEFENSE\n';
    csv += `Flag Pulls,${game.stats.defense.flagPulls}\n`;
    csv += `Interceptions,${game.stats.defense.interceptions}\n\n`;
    
    // Player Stats - Passing
    const passers = Object.values(game.playerStats || {}).filter(p => p.offense.passAttempts > 0);
    if (passers.length > 0) {
      csv += 'PLAYER STATS - PASSING\n';
      csv += 'Player,ATT,CMP,YDS,TD,INT\n';
      passers.forEach(p => {
        csv += `#${p.number} ${p.name},${p.offense.passAttempts},${p.offense.completions},${p.offense.passingYards},${p.offense.touchdowns},${p.offense.interceptions}\n`;
      });
      csv += '\n';
    }
    
    // Player Stats - Rushing
    const rushers = Object.values(game.playerStats || {}).filter(p => p.offense.rushAttempts > 0);
    if (rushers.length > 0) {
      csv += 'PLAYER STATS - RUSHING\n';
      csv += 'Player,ATT,YDS,TD\n';
      rushers.forEach(p => {
        csv += `#${p.number} ${p.name},${p.offense.rushAttempts},${p.offense.rushingYards},${p.offense.touchdowns}\n`;
      });
      csv += '\n';
    }
    
    // Player Stats - Receiving
    const receivers = Object.values(game.playerStats || {}).filter(p => p.offense.receptions > 0);
    if (receivers.length > 0) {
      csv += 'PLAYER STATS - RECEIVING\n';
      csv += 'Player,REC,YDS,TD\n';
      receivers.forEach(p => {
        csv += `#${p.number} ${p.name},${p.offense.receptions},${p.offense.receivingYards},${p.offense.touchdowns}\n`;
      });
      csv += '\n';
    }
    
    // Player Stats - Defense
    const defenders = Object.values(game.playerStats || {}).filter(p => p.defense.flagPulls > 0 || p.defense.interceptions > 0 || p.defense.tacklesForLoss > 0 || p.defense.passDeflections > 0);
    if (defenders.length > 0) {
      csv += 'PLAYER STATS - DEFENSE\n';
      csv += 'Player,Tackles,TFL,INT,PD\n';
      defenders.forEach(p => {
        csv += `#${p.number} ${p.name},${p.defense.flagPulls},${p.defense.tacklesForLoss || 0},${p.defense.interceptions},${p.defense.passDeflections || 0}\n`;
      });
    }
    
    // Try Share API first (works better on mobile)
    if (navigator.share) {
      const blob = new Blob([csv], { type: 'text/csv' });
      const file = new File([blob], `${game.teamName}_vs_${game.opponentName}.csv`, { type: 'text/csv' });
      navigator.share({
        files: [file],
        title: 'Game Stats',
        text: `Stats for ${game.teamName} vs ${game.opponentName}`
      }).catch(err => {
        // If share fails, fall back to data URL
        console.log('Share failed, using download:', err);
        const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `${game.teamName}_vs_${game.opponentName}_${new Date(game.date).toLocaleDateString().replace(/\//g, '-')}.csv`;
        link.click();
      });
    } else {
      // Fallback to data URL for browsers without Share API
      const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${game.teamName}_vs_${game.opponentName}_${new Date(game.date).toLocaleDateString().replace(/\//g, '-')}.csv`;
      link.click();
    }
  };

  const emailCSV = (game) => {
    const subject = encodeURIComponent(`Game Stats: ${game.teamName} vs ${game.opponentName}`);
    const body = encodeURIComponent(`Final Score: ${game.score.team} - ${game.score.opponent}\nDate: ${new Date(game.date).toLocaleDateString()}\n\nView full stats in the attached CSV file.`);
    const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
    // Use anchor click instead of window.location to avoid CSP issues
    const a = document.createElement('a');
    a.href = mailtoLink;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Game functions
  const calculateYardsToFirstDown = (los, currentTarget) => {
    // If we have a current target and haven't crossed it yet, use it
    if (currentTarget && los < currentTarget) {
      return currentTarget - los;
    }
    // Otherwise calculate new target
    if (los >= 51) return 0;
    if (los >= 34) return 51 - los;
    if (los >= 17) return 34 - los;
    return 17 - los;
  };

  const getFirstDownTargetLine = (los, currentTarget) => {
    // If we have a current target and haven't crossed it, keep it
    // This prevents the target from moving backwards on penalties or negative plays
    if (currentTarget && los < currentTarget) {
      return currentTarget;
    }
    // Otherwise calculate new target based on position
    if (los >= 34) return 51;
    if (los >= 17) return 34;
    return 17;
  };

  const addPlay = (playData) => {
    const g = { ...currentGame };
    
    // Store state BEFORE this play for undo purposes
    const stateBeforePlay = {
      down: g.down,
      yardsToGo: g.yardsToGo,
      lineOfScrimmage: g.lineOfScrimmage,
      firstDownTarget: g.firstDownTarget
    };
    
    g.plays.push({ id: Date.now(), ...playData, ...stateBeforePlay });
    
    // Update team stats and player stats
    if (playData.possession === 'team') {
      // Team offense
      if (playData.playType === 'pass') {
        g.stats.offense.passAttempts++; g.stats.offense.totalPlays++;
        if (playData.complete) { 
          g.stats.offense.completions++; 
          g.stats.offense.passingYards += playData.yards;
        }
        // Player stats - passer
        if (playData.passer && g.playerStats[playData.passer]) {
          g.playerStats[playData.passer].offense.passAttempts++;
          if (playData.complete) {
            g.playerStats[playData.passer].offense.completions++;
            g.playerStats[playData.passer].offense.passingYards += playData.yards;
          } else {
            g.playerStats[playData.passer].offense.incompletions++;
          }
          if (playData.interception) g.playerStats[playData.passer].offense.interceptions++;
          if (playData.touchdown) g.playerStats[playData.passer].offense.touchdowns++;
        }
        // Player stats - receiver
        if (playData.complete && playData.receiver && g.playerStats[playData.receiver]) {
          g.playerStats[playData.receiver].offense.receptions++;
          g.playerStats[playData.receiver].offense.receivingYards += playData.yards;
          if (playData.touchdown) g.playerStats[playData.receiver].offense.touchdowns++;
        }
      } else if (playData.playType === 'run') {
        g.stats.offense.rushAttempts++; 
        g.stats.offense.rushingYards += playData.yards; 
        g.stats.offense.totalPlays++;
        // Player stats - rusher
        if (playData.rusher && g.playerStats[playData.rusher]) {
          g.playerStats[playData.rusher].offense.rushAttempts++;
          g.playerStats[playData.rusher].offense.rushingYards += playData.yards;
          if (playData.touchdown) g.playerStats[playData.rusher].offense.touchdowns++;
        }
      }
      if (playData.firstDown) g.stats.offense.firstDowns++;
      if (playData.touchdown) { g.stats.offense.touchdowns++; g.score.team += 6; }
      if (playData.interception) g.stats.offense.interceptions++;
    } else {
      // Opponent has possession - track our defense
      if (playData.touchdown) { g.score.opponent += 6; }
      
      // Track flag pulls (always credit, regardless of yards)
      if (playData.flagPull && playData.defender && g.playerStats[playData.defender]) {
        g.playerStats[playData.defender].defense.flagPulls++;
        g.stats.defense.flagPulls++;
        
        // Check for tackle for loss (negative yards)
        if (playData.yards < 0) {
          g.playerStats[playData.defender].defense.tacklesForLoss++;
        }
      }
      
      // Track interceptions
      if (playData.interception && playData.defender && g.playerStats[playData.defender]) {
        g.playerStats[playData.defender].defense.interceptions++;
        g.stats.defense.interceptions++;
      }
      
      // Track pass deflections
      if (playData.passDeflection && playData.defender && g.playerStats[playData.defender]) {
        g.playerStats[playData.defender].defense.passDeflections++;
      }
    }
    
    if (playData.safety) {
      if (playData.possession === 'team') g.score.opponent += 2;
      else g.score.team += 2;
      g.possession = playData.possession; g.down = 1; g.lineOfScrimmage = 5; g.yardsToGo = 12; g.firstDownTarget = 17;
      setCurrentGame(g); saveGame(g); return;
    }
    
    // Handle special cases first
    if (playData.touchdown) {
      setCurrentGame(g); saveGame(g); 
      setGameMode('pointAfter'); // Switch to point after mode
      return;
    }
    
    if (playData.interception) {
      g.awaitingInterceptionInfo = true;
      g.interceptionTeam = playData.possession === 'team' ? 'opponent' : 'team';
      setCurrentGame(g); saveGame(g); return;
    }
    
    if (playData.isPunt) {
      // Track forced punts when opponent punts
      if (g.possession !== 'team') {
        if (!g.stats.defense.forcedPunts) g.stats.defense.forcedPunts = 0;
        g.stats.defense.forcedPunts++;
      }
      g.possession = g.possession === 'team' ? 'opponent' : 'team';
      g.down = 1; g.lineOfScrimmage = 5; g.yardsToGo = 12; g.firstDownTarget = 17;
      setCurrentGame(g); saveGame(g); return;
    }
    
    // Update field position
    const newLOS = g.lineOfScrimmage + playData.yards;
    g.lineOfScrimmage = Math.max(0, Math.min(51, newLOS));
    
    // Get or preserve the current first down target
    const currentTarget = g.firstDownTarget || getFirstDownTargetLine(g.lineOfScrimmage, null);
    const crossedTarget = newLOS >= currentTarget;
    
    if (crossedTarget || playData.firstDown) {
      // Got first down - reset downs and calculate new target
      g.down = 1;
      g.firstDownTarget = getFirstDownTargetLine(g.lineOfScrimmage, null);
      g.yardsToGo = calculateYardsToFirstDown(g.lineOfScrimmage, g.firstDownTarget);
      if (!playData.firstDown) g.stats.offense.firstDowns++;
    } else {
      // Didn't get first down - keep same target
      g.down++;
      if (g.down > 4) {
        // Turnover on downs
        const wasScoringTeam = g.possession === 'team';
        g.possession = g.possession === 'team' ? 'opponent' : 'team';
        g.down = 1;
        g.firstDownTarget = getFirstDownTargetLine(g.lineOfScrimmage, null);
        g.yardsToGo = calculateYardsToFirstDown(g.lineOfScrimmage, g.firstDownTarget);
        
        // If opponent turned over, credit defense
        if (!wasScoringTeam) {
          if (!g.stats.defense.turnoversOnDowns) g.stats.defense.turnoversOnDowns = 0;
          g.stats.defense.turnoversOnDowns++;
        }
      } else {
        // Same possession, same target - just update yards to go
        g.firstDownTarget = currentTarget;
        g.yardsToGo = calculateYardsToFirstDown(g.lineOfScrimmage, currentTarget);
      }
    }
    
    setCurrentGame(g); saveGame(g);
  };

  const recordPlay = () => {
    if (gameMode === 'pointAfter') {
      const g = { ...currentGame };
      if (pointAfterSuccess) {
        if (g.possession === 'team') g.score.team += pointAfterType;
        else g.score.opponent += pointAfterType;
      }
      g.possession = g.possession === 'team' ? 'opponent' : 'team';
      g.down = 1; g.lineOfScrimmage = 5; g.yardsToGo = 12; g.firstDownTarget = 17;
      setCurrentGame(g); saveGame(g);
      setGameMode('normal');
      setPointAfterType(1);
      setPointAfterSuccess(true);
      // After point after, possession switches - set defense defaults
      setPlayers({ passer: '', receiver: '', rusher: '', defender: '' });
      setFlags({ complete: true, firstDown: false, touchdown: false, turnover: false, interception: false, flagPull: true, safety: false, passDeflection: false, incomplete: false });
    } else if (gameMode === 'penalty') {
      // Handle penalty
      const g = { ...currentGame };
      const penaltyAmount = penaltyOnOffense ? -penaltyYards : penaltyYards;
      const newLOS = Math.max(0, Math.min(51, g.lineOfScrimmage + penaltyAmount));
      g.lineOfScrimmage = newLOS;
      
      // Preserve the first down target - don't recalculate
      const preservedTarget = g.firstDownTarget || getFirstDownTargetLine(g.lineOfScrimmage, null);
      g.firstDownTarget = preservedTarget;
      g.yardsToGo = calculateYardsToFirstDown(newLOS, preservedTarget);
      
      if (penaltyLossOfDown) {
        g.down++;
        if (g.down > 4) {
          g.possession = g.possession === 'team' ? 'opponent' : 'team';
          g.down = 1;
          g.lineOfScrimmage = newLOS;
          g.firstDownTarget = getFirstDownTargetLine(newLOS, null);
          g.yardsToGo = calculateYardsToFirstDown(newLOS, g.firstDownTarget);
        }
      }
      // Else replay down (no change to down number)
      
      g.plays.push({ 
        id: Date.now(), 
        playType: 'penalty', 
        yards: penaltyAmount, 
        onOffense: penaltyOnOffense, 
        lossOfDown: penaltyLossOfDown,
        down: g.down,
        yardsToGo: g.yardsToGo,
        lineOfScrimmage: g.lineOfScrimmage,
        firstDownTarget: g.firstDownTarget
      });
      setCurrentGame(g); saveGame(g);
      setGameMode('normal');
      setPenaltyYards(0);
      setPenaltyOnOffense(true);
      setPenaltyLossOfDown(false);
    } else if (playType === 'punt') {
      addPlay({ possession: currentGame.possession, playType: 'punt', isPunt: true, yards: 0 });
    } else {
      // Auto-detect first down if yards gained >= yardsToGo
      const autoFirstDown = yards >= currentGame.yardsToGo && currentGame.yardsToGo > 0;
      
      addPlay({ 
        possession: currentGame.possession, 
        playType, 
        yards, 
        complete: playType === 'pass' ? flags.complete : true, 
        firstDown: flags.firstDown || autoFirstDown, 
        touchdown: flags.touchdown, 
        turnover: flags.turnover, 
        interception: flags.interception, 
        flagPull: flags.flagPull, 
        safety: flags.safety,
        passDeflection: flags.passDeflection,
        passer: playType === 'pass' ? players.passer : null,
        receiver: playType === 'pass' && flags.complete ? players.receiver : null,
        rusher: playType === 'run' ? players.rusher : null,
        defender: !isOffense ? players.defender : null
      });
      
      // Remember last passer/rusher for next play (do this BEFORE resetting players)
      const newLastPasser = playType === 'pass' && players.passer ? players.passer : lastPasser;
      const newLastRusher = playType === 'run' && players.rusher ? players.rusher : lastRusher;
      
      if (playType === 'pass' && players.passer) setLastPasser(players.passer);
      if (playType === 'run' && players.rusher) setLastRusher(players.rusher);
      
      // Immediately use the new values for resetting
      setYards(0);
      
      // Determine possession after this play
      const wasOffense = currentGame.possession === 'team';
      
      if (wasOffense) {
        // We were on offense - restore last passer/rusher (use NEW values)
        setPlayers({ 
          passer: newLastPasser, 
          receiver: '', 
          rusher: newLastRusher, 
          defender: '' 
        });
        setFlags({ complete: true, firstDown: false, touchdown: false, turnover: false, interception: false, flagPull: false, safety: false, passDeflection: false, incomplete: false });
      } else {
        // Defense - default to flag pull
        setPlayers({ passer: '', receiver: '', rusher: '', defender: '' });
        setFlags({ complete: true, firstDown: false, touchdown: false, turnover: false, interception: false, flagPull: true, safety: false, passDeflection: false, incomplete: false });
      }
    }
  };

  const handleInterceptionDetails = (isTD, fieldPos) => {
    const g = { ...currentGame };
    delete g.awaitingInterceptionInfo;
    g.possession = g.interceptionTeam;
    delete g.interceptionTeam;
    if (isTD) { 
      if (g.possession === 'team') g.score.team += 6; 
      else g.score.opponent += 6; 
    } else { 
      g.down = 1; 
      g.lineOfScrimmage = fieldPos; 
      g.firstDownTarget = getFirstDownTargetLine(fieldPos, null);
      g.yardsToGo = calculateYardsToFirstDown(fieldPos, g.firstDownTarget); 
    }
    setCurrentGame(g); saveGame(g);
  };

  const endHalf = (nextPoss) => {
    const g = { ...currentGame };
    if (g.half === 1) { 
      g.half = 2; 
      g.possession = nextPoss; 
      g.down = 1; 
      g.lineOfScrimmage = 5; 
      g.yardsToGo = 12; 
      g.firstDownTarget = 17;
      setCurrentGame(g); 
      saveGame(g); 
    }
  };

  const endGame = async () => {
    // Prevent multiple simultaneous calls
    if (endingGame) {
      console.log('Already ending game, ignoring duplicate call');
      return;
    }
    setEndingGame(true);
    
    const g = { ...currentGame };
    
    // Check if game is tied after regulation
    if (g.half === 2 && g.score.team === g.score.opponent) {
      g.awaitingOvertimeSetup = true;
      setCurrentGame(g);
      setEndingGame(false);
      return;
    }
    
    // Check if overtime is tied after a round
    if (g.half === 'OT' && g.score.team === g.score.opponent) {
      // Continue to next OT round
      g.overtimeRound = (g.overtimeRound || 1) + 1;
      g.awaitingOvertimeConversion = true;
      g.possession = g.overtimeFirstOffense;
      setCurrentGame(g);
      saveGame(g);
      setEndingGame(false);
      return;
    }
    
    // Check if game was already completed - prevent double counting
    if (g.completed) {
      alert('This game has already been completed and counted in season stats!');
      setView('stats');
      setEndingGame(false);
      return;
    }
    
    // Game is over - determine winner
    g.completed = true;
    g.completedDate = new Date().toISOString();
    
    if (g.score.team > g.score.opponent) {
      g.result = 'win';
    } else if (g.score.team < g.score.opponent) {
      g.result = 'loss';
    } else {
      g.result = 'tie';
    }
    
    // Save completed game first
    await saveGame(g);
    setCurrentGame(g);
    
    // Update season stats (NO RETRY LOOP - just do it once)
    try {
      const newSeasonStats = { ...seasonStats };
      
      // Update team record
      newSeasonStats.teamStats.gamesPlayed = (newSeasonStats.teamStats.gamesPlayed || 0) + 1;
      if (g.result === 'win') newSeasonStats.teamStats.wins = (newSeasonStats.teamStats.wins || 0) + 1;
      else if (g.result === 'loss') newSeasonStats.teamStats.losses = (newSeasonStats.teamStats.losses || 0) + 1;
      else newSeasonStats.teamStats.ties = (newSeasonStats.teamStats.ties || 0) + 1;
      
      newSeasonStats.teamStats.totalPointsFor = (newSeasonStats.teamStats.totalPointsFor || 0) + g.score.team;
      newSeasonStats.teamStats.totalPointsAgainst = (newSeasonStats.teamStats.totalPointsAgainst || 0) + g.score.opponent;
      
      // Aggregate offense stats
      if (!newSeasonStats.teamStats.offense) {
        newSeasonStats.teamStats.offense = { passAttempts: 0, completions: 0, passingYards: 0, rushAttempts: 0, rushingYards: 0, firstDowns: 0, touchdowns: 0, totalPlays: 0 };
      }
      newSeasonStats.teamStats.offense.passAttempts += g.stats.offense.passAttempts || 0;
      newSeasonStats.teamStats.offense.completions += g.stats.offense.completions || 0;
      newSeasonStats.teamStats.offense.passingYards += g.stats.offense.passingYards || 0;
      newSeasonStats.teamStats.offense.rushAttempts += g.stats.offense.rushAttempts || 0;
      newSeasonStats.teamStats.offense.rushingYards += g.stats.offense.rushingYards || 0;
      newSeasonStats.teamStats.offense.firstDowns += g.stats.offense.firstDowns || 0;
      newSeasonStats.teamStats.offense.touchdowns += g.stats.offense.touchdowns || 0;
      newSeasonStats.teamStats.offense.totalPlays += g.stats.offense.totalPlays || 0;
      
      // Aggregate defense stats
      if (!newSeasonStats.teamStats.defense) {
        newSeasonStats.teamStats.defense = { flagPulls: 0, interceptions: 0, forcedPunts: 0, turnoversOnDowns: 0 };
      }
      newSeasonStats.teamStats.defense.flagPulls += g.stats.defense.flagPulls || 0;
      newSeasonStats.teamStats.defense.interceptions += g.stats.defense.interceptions || 0;
      newSeasonStats.teamStats.defense.forcedPunts = (newSeasonStats.teamStats.defense.forcedPunts || 0) + (g.stats.defense.forcedPunts || 0);
      newSeasonStats.teamStats.defense.turnoversOnDowns = (newSeasonStats.teamStats.defense.turnoversOnDowns || 0) + (g.stats.defense.turnoversOnDowns || 0);
      
      // Aggregate player stats
      if (!newSeasonStats.playerStats) newSeasonStats.playerStats = {};
      Object.entries(g.playerStats || {}).forEach(([playerId, stats]) => {
        if (!newSeasonStats.playerStats[playerId]) {
          newSeasonStats.playerStats[playerId] = JSON.parse(JSON.stringify(stats));
        } else {
          // Aggregate offense
          newSeasonStats.playerStats[playerId].offense.passAttempts += stats.offense.passAttempts || 0;
          newSeasonStats.playerStats[playerId].offense.completions += stats.offense.completions || 0;
          newSeasonStats.playerStats[playerId].offense.incompletions += stats.offense.incompletions || 0;
          newSeasonStats.playerStats[playerId].offense.passingYards += stats.offense.passingYards || 0;
          newSeasonStats.playerStats[playerId].offense.interceptions += stats.offense.interceptions || 0;
          newSeasonStats.playerStats[playerId].offense.rushAttempts += stats.offense.rushAttempts || 0;
          newSeasonStats.playerStats[playerId].offense.rushingYards += stats.offense.rushingYards || 0;
          newSeasonStats.playerStats[playerId].offense.receptions += stats.offense.receptions || 0;
          newSeasonStats.playerStats[playerId].offense.receivingYards += stats.offense.receivingYards || 0;
          newSeasonStats.playerStats[playerId].offense.touchdowns += stats.offense.touchdowns || 0;
          
          // Aggregate defense
          newSeasonStats.playerStats[playerId].defense.flagPulls += stats.defense.flagPulls || 0;
          newSeasonStats.playerStats[playerId].defense.interceptions += stats.defense.interceptions || 0;
          newSeasonStats.playerStats[playerId].defense.tacklesForLoss = (newSeasonStats.playerStats[playerId].defense.tacklesForLoss || 0) + (stats.defense.tacklesForLoss || 0);
          newSeasonStats.playerStats[playerId].defense.passDeflections = (newSeasonStats.playerStats[playerId].defense.passDeflections || 0) + (stats.defense.passDeflections || 0);
        }
      });
      
      // Save to storage
      if (window.localStorage) {
        localStorage.setItem('season_stats', JSON.stringify(newSeasonStats));
      }
      
      // Update state ONCE
      setSeasonStats(newSeasonStats);
      
    } catch (error) {
      console.error('Error updating season stats:', error);
      alert('Warning: Season stats may not have been saved properly. Game stats are saved.');
    }
    
    // Show final score and go to stats
    alert(`Game Over! Final: ${g.teamName} ${g.score.team} - ${g.opponentName} ${g.score.opponent}`);
    setView('stats');
    setEndingGame(false);
  };

  const startOvertime = (firstOff) => {
    const g = { ...currentGame };
    delete g.awaitingOvertimeSetup;
    g.isOvertime = true; g.half = 'OT'; g.overtimeRound = 1;
    g.overtimeFirstOffense = firstOff; g.possession = firstOff;
    g.awaitingOvertimeConversion = true;
    setCurrentGame(g); saveGame(g);
  };

  const handleOTConversion = (success) => {
    const g = { ...currentGame };
    if (success) { if (g.possession === 'team') g.score.team += otConversionType; else g.score.opponent += otConversionType; }
    const plays = g.plays.filter(p => p.isOvertimeConversion && p.overtimeRound === g.overtimeRound);
    const teamDone = plays.some(p => p.possession === 'team') || g.possession === 'team';
    const oppDone = plays.some(p => p.possession === 'opponent') || g.possession === 'opponent';
    g.plays.push({ id: Date.now(), isOvertimeConversion: true, overtimeRound: g.overtimeRound, possession: g.possession, success, points: success ? otConversionType : 0 });
    if (teamDone && oppDone) {
      if (g.score.team !== g.score.opponent) { alert(`Game Over! Final: ${g.teamName} ${g.score.team} - ${g.opponentName} ${g.score.opponent} (OT)`); delete g.awaitingOvertimeConversion; setCurrentGame(g); saveGame(g); setView('stats'); return; }
      else { g.overtimeRound++; g.possession = g.overtimeFirstOffense; }
    } else { g.possession = g.possession === 'team' ? 'opponent' : 'team'; }
    setCurrentGame(g); saveGame(g);
  };

  const adjustScore = (team, amt) => {
    const g = { ...currentGame };
    if (team === 'team') g.score.team = Math.max(0, g.score.team + amt);
    else g.score.opponent = Math.max(0, g.score.opponent + amt);
    setCurrentGame(g); saveGame(g);
  };

  const resumeGame = async (game) => {
    // If game was completed, subtract its stats from season before resuming
    if (game.completed) {
      try {
        const newSeasonStats = { ...seasonStats };
        
        // Subtract from record
        if (game.result === 'win') newSeasonStats.teamStats.wins = Math.max(0, (newSeasonStats.teamStats.wins || 0) - 1);
        else if (game.result === 'loss') newSeasonStats.teamStats.losses = Math.max(0, (newSeasonStats.teamStats.losses || 0) - 1);
        else newSeasonStats.teamStats.ties = Math.max(0, (newSeasonStats.teamStats.ties || 0) - 1);
        
        newSeasonStats.teamStats.gamesPlayed = Math.max(0, (newSeasonStats.teamStats.gamesPlayed || 0) - 1);
        newSeasonStats.teamStats.totalPointsFor = Math.max(0, (newSeasonStats.teamStats.totalPointsFor || 0) - game.score.team);
        newSeasonStats.teamStats.totalPointsAgainst = Math.max(0, (newSeasonStats.teamStats.totalPointsAgainst || 0) - game.score.opponent);
        
        // Subtract offense stats
        if (newSeasonStats.teamStats.offense) {
          newSeasonStats.teamStats.offense.passAttempts = Math.max(0, newSeasonStats.teamStats.offense.passAttempts - game.stats.offense.passAttempts);
          newSeasonStats.teamStats.offense.completions = Math.max(0, newSeasonStats.teamStats.offense.completions - game.stats.offense.completions);
          newSeasonStats.teamStats.offense.passingYards = Math.max(0, newSeasonStats.teamStats.offense.passingYards - game.stats.offense.passingYards);
          newSeasonStats.teamStats.offense.rushAttempts = Math.max(0, newSeasonStats.teamStats.offense.rushAttempts - game.stats.offense.rushAttempts);
          newSeasonStats.teamStats.offense.rushingYards = Math.max(0, newSeasonStats.teamStats.offense.rushingYards - game.stats.offense.rushingYards);
          newSeasonStats.teamStats.offense.firstDowns = Math.max(0, newSeasonStats.teamStats.offense.firstDowns - game.stats.offense.firstDowns);
          newSeasonStats.teamStats.offense.touchdowns = Math.max(0, newSeasonStats.teamStats.offense.touchdowns - game.stats.offense.touchdowns);
          newSeasonStats.teamStats.offense.totalPlays = Math.max(0, newSeasonStats.teamStats.offense.totalPlays - game.stats.offense.totalPlays);
        }
        
        // Subtract defense stats
        if (newSeasonStats.teamStats.defense) {
          newSeasonStats.teamStats.defense.flagPulls = Math.max(0, newSeasonStats.teamStats.defense.flagPulls - game.stats.defense.flagPulls);
          newSeasonStats.teamStats.defense.interceptions = Math.max(0, newSeasonStats.teamStats.defense.interceptions - game.stats.defense.interceptions);
          newSeasonStats.teamStats.defense.forcedPunts = Math.max(0, (newSeasonStats.teamStats.defense.forcedPunts || 0) - (game.stats.defense.forcedPunts || 0));
          newSeasonStats.teamStats.defense.turnoversOnDowns = Math.max(0, (newSeasonStats.teamStats.defense.turnoversOnDowns || 0) - (game.stats.defense.turnoversOnDowns || 0));
        }
        
        // Subtract player stats
        Object.entries(game.playerStats || {}).forEach(([playerId, stats]) => {
          if (newSeasonStats.playerStats && newSeasonStats.playerStats[playerId]) {
            const p = newSeasonStats.playerStats[playerId];
            p.offense.passAttempts = Math.max(0, p.offense.passAttempts - stats.offense.passAttempts);
            p.offense.completions = Math.max(0, p.offense.completions - stats.offense.completions);
            p.offense.passingYards = Math.max(0, p.offense.passingYards - stats.offense.passingYards);
            p.offense.rushAttempts = Math.max(0, p.offense.rushAttempts - stats.offense.rushAttempts);
            p.offense.rushingYards = Math.max(0, p.offense.rushingYards - stats.offense.rushingYards);
            p.offense.receptions = Math.max(0, p.offense.receptions - stats.offense.receptions);
            p.offense.receivingYards = Math.max(0, p.offense.receivingYards - stats.offense.receivingYards);
            p.offense.touchdowns = Math.max(0, p.offense.touchdowns - stats.offense.touchdowns);
            p.defense.flagPulls = Math.max(0, p.defense.flagPulls - stats.defense.flagPulls);
            p.defense.interceptions = Math.max(0, p.defense.interceptions - stats.defense.interceptions);
            p.defense.tacklesForLoss = Math.max(0, (p.defense.tacklesForLoss || 0) - (stats.defense.tacklesForLoss || 0));
            p.defense.passDeflections = Math.max(0, (p.defense.passDeflections || 0) - (stats.defense.passDeflections || 0));
          }
        });
        
        // Mark game as not completed so it can be re-ended
        game.completed = false;
        delete game.result;
        delete game.completedDate;
        await saveGame(game);
        
        setSeasonStats(newSeasonStats);
        if (window.localStorage) {
          await localStorage.setItem('season_stats', JSON.stringify(newSeasonStats));
        }
      } catch (error) {
        console.error('Error subtracting stats:', error);
      }
    }
    
    setCurrentGame(game);
    setView('game');
  };

  const undoLastPlay = () => {
    if (!currentGame) {
      alert('No game in progress!');
      return;
    }
    
    if (!currentGame.plays || currentGame.plays.length === 0) {
      alert('No plays to undo!');
      return;
    }
    
    // Show custom confirmation dialog instead of browser confirm()
    setShowUndoConfirm(true);
  };

  const confirmUndo = () => {
    setShowUndoConfirm(false);
    
    const g = { ...currentGame };
    const lastPlay = g.plays[g.plays.length - 1];
    
    // Skip if it's a penalty - penalties are simpler and don't affect stats
    if (lastPlay.playType === 'penalty') {
      g.plays.pop();
      // Try to restore from previous play if exists
      if (g.plays.length > 0) {
        const prevPlay = g.plays[g.plays.length - 1];
        g.down = prevPlay.down;
        g.yardsToGo = prevPlay.yardsToGo;
        g.lineOfScrimmage = prevPlay.lineOfScrimmage;
      }
      setCurrentGame(g);
      saveGame(g);
      return;
    }
    
    // Remove the play
    g.plays.pop();
    
    // Find the previous play to restore state from
    const prevPlay = g.plays.length > 0 ? g.plays[g.plays.length - 1] : null;
    
    // Restore game state - if there was a previous play, use its state AFTER that play executed
    // Otherwise use initial state
    if (prevPlay) {
      // The previous play stored the state BEFORE it was executed
      // We need to calculate what state would be AFTER executing it
      // For simplicity, let's look at the play we're undoing and reverse from current state
      g.down = lastPlay.down;
      g.yardsToGo = lastPlay.yardsToGo;
      g.lineOfScrimmage = lastPlay.lineOfScrimmage;
      g.firstDownTarget = lastPlay.firstDownTarget || getFirstDownTargetLine(lastPlay.lineOfScrimmage, null);
    } else {
      // No previous play - restore to initial state
      g.down = 1;
      g.lineOfScrimmage = 5;
      g.yardsToGo = 12;
      g.firstDownTarget = 17;
    }
    
    // Reverse stats
    if (lastPlay.playType === 'pass' && lastPlay.possession === 'team') {
      g.stats.offense.passAttempts = Math.max(0, g.stats.offense.passAttempts - 1);
      g.stats.offense.totalPlays = Math.max(0, g.stats.offense.totalPlays - 1);
      if (lastPlay.complete) {
        g.stats.offense.completions = Math.max(0, g.stats.offense.completions - 1);
        g.stats.offense.passingYards = Math.max(0, g.stats.offense.passingYards - lastPlay.yards);
      }
      if (lastPlay.passer && g.playerStats[lastPlay.passer]) {
        g.playerStats[lastPlay.passer].offense.passAttempts = Math.max(0, g.playerStats[lastPlay.passer].offense.passAttempts - 1);
        if (lastPlay.complete) {
          g.playerStats[lastPlay.passer].offense.completions = Math.max(0, g.playerStats[lastPlay.passer].offense.completions - 1);
          g.playerStats[lastPlay.passer].offense.passingYards = Math.max(0, g.playerStats[lastPlay.passer].offense.passingYards - lastPlay.yards);
        } else {
          g.playerStats[lastPlay.passer].offense.incompletions = Math.max(0, g.playerStats[lastPlay.passer].offense.incompletions - 1);
        }
        if (lastPlay.interception) g.playerStats[lastPlay.passer].offense.interceptions = Math.max(0, g.playerStats[lastPlay.passer].offense.interceptions - 1);
      }
      if (lastPlay.complete && lastPlay.receiver && g.playerStats[lastPlay.receiver]) {
        g.playerStats[lastPlay.receiver].offense.receptions = Math.max(0, g.playerStats[lastPlay.receiver].offense.receptions - 1);
        g.playerStats[lastPlay.receiver].offense.receivingYards = Math.max(0, g.playerStats[lastPlay.receiver].offense.receivingYards - lastPlay.yards);
      }
    } else if (lastPlay.playType === 'run' && lastPlay.possession === 'team') {
      g.stats.offense.rushAttempts = Math.max(0, g.stats.offense.rushAttempts - 1);
      g.stats.offense.rushingYards = Math.max(0, g.stats.offense.rushingYards - lastPlay.yards);
      g.stats.offense.totalPlays = Math.max(0, g.stats.offense.totalPlays - 1);
      if (lastPlay.rusher && g.playerStats[lastPlay.rusher]) {
        g.playerStats[lastPlay.rusher].offense.rushAttempts = Math.max(0, g.playerStats[lastPlay.rusher].offense.rushAttempts - 1);
        g.playerStats[lastPlay.rusher].offense.rushingYards = Math.max(0, g.playerStats[lastPlay.rusher].offense.rushingYards - lastPlay.yards);
      }
    }
    
    // Reverse scoring
    if (lastPlay.touchdown) {
      if (lastPlay.possession === 'team') {
        g.score.team = Math.max(0, g.score.team - 6);
        g.stats.offense.touchdowns = Math.max(0, g.stats.offense.touchdowns - 1);
        if (lastPlay.passer && g.playerStats[lastPlay.passer]) g.playerStats[lastPlay.passer].offense.touchdowns = Math.max(0, g.playerStats[lastPlay.passer].offense.touchdowns - 1);
        if (lastPlay.receiver && g.playerStats[lastPlay.receiver]) g.playerStats[lastPlay.receiver].offense.touchdowns = Math.max(0, g.playerStats[lastPlay.receiver].offense.touchdowns - 1);
        if (lastPlay.rusher && g.playerStats[lastPlay.rusher]) g.playerStats[lastPlay.rusher].offense.touchdowns = Math.max(0, g.playerStats[lastPlay.rusher].offense.touchdowns - 1);
      } else {
        g.score.opponent = Math.max(0, g.score.opponent - 6);
      }
    }
    
    // Reverse first down stat
    if (lastPlay.firstDown && lastPlay.possession === 'team') {
      g.stats.offense.firstDowns = Math.max(0, g.stats.offense.firstDowns - 1);
    }
    
    // Reverse defensive stats
    if (lastPlay.flagPull && lastPlay.defender && g.playerStats[lastPlay.defender]) {
      g.playerStats[lastPlay.defender].defense.flagPulls = Math.max(0, g.playerStats[lastPlay.defender].defense.flagPulls - 1);
      g.stats.defense.flagPulls = Math.max(0, g.stats.defense.flagPulls - 1);
      if (lastPlay.yards < 0 && g.playerStats[lastPlay.defender].defense.tacklesForLoss > 0) {
        g.playerStats[lastPlay.defender].defense.tacklesForLoss = Math.max(0, g.playerStats[lastPlay.defender].defense.tacklesForLoss - 1);
      }
    }
    if (lastPlay.interception && lastPlay.defender && g.playerStats[lastPlay.defender]) {
      g.playerStats[lastPlay.defender].defense.interceptions = Math.max(0, g.playerStats[lastPlay.defender].defense.interceptions - 1);
      g.stats.defense.interceptions = Math.max(0, g.stats.defense.interceptions - 1);
    }
    if (lastPlay.passDeflection && lastPlay.defender && g.playerStats[lastPlay.defender]) {
      g.playerStats[lastPlay.defender].defense.passDeflections = Math.max(0, g.playerStats[lastPlay.defender].defense.passDeflections - 1);
    }
    
    setCurrentGame(g);
    saveGame(g);
  };

  const isOffense = currentGame && currentGame.possession === 'team';
  const getFirstDownTarget = () => {
    if (!currentGame) return '';
    const target = currentGame.firstDownTarget || getFirstDownTargetLine(currentGame.lineOfScrimmage, null);
    if (target === 51) return 'END';
    return target.toString();
  };

  // Render
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50">
      {!storageAvailable && (
        <div className="bg-yellow-500 text-white p-4 text-center font-bold">
          ⚠️ Storage not available - data will not persist
        </div>
      )}

      {/* HOME VIEW */}
      {view === 'home' && (
        <div className="p-6 max-w-4xl mx-auto">
          <div className="bg-gradient-to-r from-green-600 to-blue-600 rounded-2xl shadow-2xl p-8 mb-8 text-white">
            <div className="flex items-center gap-4 mb-4">
              🏁
              <div className="flex-1">
                <h1 className="text-4xl font-bold">{teamName || 'Flag Football Tracker'}</h1>
                <p className="text-green-100 text-lg">WIAA Washington State Rules</p>
                {seasonStats.teamStats.gamesPlayed > 0 && (
                  <p className="text-yellow-300 text-xl font-bold mt-1">
                    {seasonStats.teamStats.wins}-{seasonStats.teamStats.losses}{seasonStats.teamStats.ties > 0 ? `-${seasonStats.teamStats.ties}` : ''}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4 mb-3">
              <button onClick={createNewGame} className="bg-white text-green-600 py-4 rounded-xl font-bold text-lg text-center flex items-center justify-center gap-2 shadow-lg hover:bg-green-50 transition transform hover:scale-105">
                New Game
              </button>
              <button onClick={() => setView('season')} className="bg-yellow-400 text-gray-900 py-4 rounded-xl font-bold text-lg text-center flex items-center justify-center gap-2 shadow-lg hover:bg-yellow-300 transition transform hover:scale-105">
                Season Stats
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={exportSeason} className="bg-blue-500 text-white py-3 rounded-xl font-bold text-base text-center flex items-center justify-center gap-2 shadow hover:bg-blue-600 transition">
                Export Season
              </button>
              <button onClick={() => setShowImportDialog(true)} className="bg-purple-500 text-white py-3 rounded-xl font-bold text-base text-center flex items-center justify-center gap-2 shadow hover:bg-purple-600 transition">
                Import Season
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              🕐
              Game History
            </h2>
            {games.length === 0 ? (
              <div className="bg-white rounded-xl shadow p-12 text-center">
                🏆
                <p className="text-gray-500 text-lg">No games yet. Start your first game above!</p>
              </div>
            ) : (
              games.map(game => (
                <div key={game.id} className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-sm text-gray-500">{new Date(game.date).toLocaleDateString()} • {game.half === 'OT' ? 'OT' : `${game.half}H`}</p>
                      <p className="text-xl font-bold text-gray-800">{game.teamName} vs {game.opponentName}</p>
                      <p className="text-3xl font-bold mt-2">
                        <span className={game.score.team > game.score.opponent ? 'text-green-600' : 'text-gray-600'}>{game.score.team}</span>
                        <span className="text-gray-400 mx-2">-</span>
                        <span className={game.score.opponent > game.score.team ? 'text-green-600' : 'text-gray-600'}>{game.score.opponent}</span>
                      </p>
                    </div>
                    <button onClick={() => deleteGame(game.id)} className="text-red-500 hover:text-red-700 p-2">
                      🗑️
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <button onClick={() => resumeGame(game)} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 rounded-lg font-semibold hover:from-blue-600 hover:to-blue-700 transition flex items-center justify-center gap-2">
                      Resume
                    </button>
                    <button onClick={() => { setCurrentGame(game); setView('stats'); }} className="bg-gradient-to-r from-purple-500 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-purple-600 hover:to-purple-700 transition flex items-center justify-center gap-2">
                      Stats
                    </button>
                    <button onClick={() => downloadCSV(game)} className="bg-gradient-to-r from-green-500 to-green-600 text-white py-3 rounded-lg font-semibold hover:from-green-600 hover:to-green-700 transition flex items-center justify-center gap-2">
                      CSV
                    </button>
                    <button onClick={() => emailCSV(game)} className="bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3 rounded-lg font-semibold hover:from-orange-600 hover:to-orange-700 transition flex items-center justify-center gap-2">
                      Email
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SETUP VIEW */}
      {view === 'setup' && (
        <div className="p-6 max-w-4xl mx-auto">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl shadow-2xl p-8 mb-8 text-white">
            <h1 className="text-4xl font-bold mb-2">New Game Setup</h1>
            <p className="text-blue-100">Configure your game details</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Game Info</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Your Team Name</label>
                  <input type="text" value={setupTeamName} onChange={(e) => setSetupTeamName(e.target.value)} placeholder="Enter team name" className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Opponent Name</label>
                  <input type="text" value={setupOpponentName} onChange={(e) => setSetupOpponentName(e.target.value)} placeholder="Enter opponent name" className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-3">First Possession</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setSetupFirstPossession('team')} className={`py-3 rounded-xl font-bold transition ${setupFirstPossession === 'team' ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg' : 'bg-gray-100 text-gray-700'}`}>{setupTeamName || 'Your Team'}</button>
                    <button onClick={() => setSetupFirstPossession('opponent')} className={`py-3 rounded-xl font-bold transition ${setupFirstPossession === 'opponent' ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg' : 'bg-gray-100 text-gray-700'}`}>{setupOpponentName || 'Opponent'}</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">👥Roster</h2>
              <div className="space-y-3 mb-4">
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={setupPlayerName} onChange={(e) => setSetupPlayerName(e.target.value)} onKeyPress={(e) => { if (e.key === 'Enter' && setupPlayerName && setupPlayerNumber) { setSetupRoster([...setupRoster, { id: Date.now(), name: setupPlayerName, number: setupPlayerNumber }]); setSetupPlayerName(''); setSetupPlayerNumber(''); } }} placeholder="Player name" className="border-2 border-gray-300 rounded-xl px-4 py-3 font-semibold focus:border-green-500 focus:outline-none" />
                  <input type="text" value={setupPlayerNumber} onChange={(e) => setSetupPlayerNumber(e.target.value)} onKeyPress={(e) => { if (e.key === 'Enter' && setupPlayerName && setupPlayerNumber) { setSetupRoster([...setupRoster, { id: Date.now(), name: setupPlayerName, number: setupPlayerNumber }]); setSetupPlayerName(''); setSetupPlayerNumber(''); } }} placeholder="Number" className="border-2 border-gray-300 rounded-xl px-4 py-3 font-semibold focus:border-green-500 focus:outline-none" />
                </div>
                <button onClick={() => { if (setupPlayerName && setupPlayerNumber) { setSetupRoster([...setupRoster, { id: Date.now(), name: setupPlayerName, number: setupPlayerNumber }]); setSetupPlayerName(''); setSetupPlayerNumber(''); setTimeout(() => { const nameInput = document.querySelector('input[placeholder="Player name"]'); if (nameInput) nameInput.focus(); }, 50); } }} className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white py-3 rounded-xl font-bold hover:from-green-600 hover:to-green-700">Add Player</button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {setupRoster.map(player => (
                  <div key={player.id} className="flex items-center justify-between bg-gradient-to-r from-gray-50 to-blue-50 p-3 rounded-xl">
                    <span className="font-semibold">#{player.number} {player.name}</span>
                    <button onClick={() => setSetupRoster(setupRoster.filter(p => p.id !== player.id))} className="text-red-500 hover:text-red-700">🗑️</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-6">
            <button onClick={() => setView('home')} className="bg-gradient-to-r from-gray-600 to-gray-700 text-white py-4 rounded-xl font-bold text-lg hover:from-gray-700 hover:to-gray-800">Cancel</button>
            <button onClick={startGame} className="bg-gradient-to-r from-green-600 to-green-700 text-white py-4 rounded-xl font-bold text-lg hover:from-green-700 hover:to-green-800">Start Game</button>
          </div>
        </div>
      )}
      
      {view === 'game' && currentGame && (
        <div className="p-4 max-w-4xl mx-auto pb-24">
          {/* Interception Dialog */}
          {currentGame.awaitingInterceptionInfo && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
                <h3 className="text-2xl font-bold mb-4">Interception Return</h3>
                <p className="text-lg mb-6">Was it returned for a touchdown?</p>
                <div className="space-y-4 mb-6">
                  <button onClick={() => setInterceptionTD(true)} className={`w-full py-4 rounded-xl font-bold text-lg ${interceptionTD ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}>✓ Touchdown</button>
                  <button onClick={() => setInterceptionTD(false)} className={`w-full py-4 rounded-xl font-bold text-lg ${!interceptionTD ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>No Touchdown</button>
                </div>
                {!interceptionTD && (
                  <div className="mb-6">
                    <label className="block text-sm font-bold mb-3">Starting Field Position</label>
                    <div className="flex gap-3 mb-3">
                      <button onClick={() => setInterceptionFieldPos(Math.max(0, interceptionFieldPos - 5))} className="bg-gray-300 px-4 py-2 rounded-lg font-bold">-5</button>
                      <input type="number" value={interceptionFieldPos} onChange={(e) => setInterceptionFieldPos(Math.max(0, Math.min(51, parseInt(e.target.value) || 0)))} className="flex-1 border-2 rounded-xl px-4 py-3 text-center text-2xl font-bold" />
                      <button onClick={() => setInterceptionFieldPos(Math.min(51, interceptionFieldPos + 5))} className="bg-gray-300 px-4 py-2 rounded-lg font-bold">+5</button>
                    </div>
                  </div>
                )}
                <button onClick={() => { handleInterceptionDetails(interceptionTD, interceptionFieldPos); setInterceptionTD(false); setInterceptionFieldPos(20); }} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold">Confirm</button>
              </div>
            </div>
          )}

          {/* Undo Confirmation Dialog */}
          {showUndoConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
                <h3 className="text-2xl font-bold mb-4 text-orange-600">⚠️ Undo Last Play</h3>
                <p className="text-lg mb-6">Are you sure you want to undo the last play? This will reverse all stats and restore the previous game state.</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setShowUndoConfirm(false)} className="bg-gray-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-gray-700">Cancel</button>
                  <button onClick={confirmUndo} className="bg-orange-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-orange-700">Yes, Undo</button>
                </div>
              </div>
            </div>
          )}
          
          {/* Overtime Setup Dialog */}
          {currentGame.awaitingOvertimeSetup && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
                <h3 className="text-2xl font-bold mb-4 text-center">⚡ OVERTIME ⚡</h3>
                <p className="text-lg mb-6 text-center">Game tied! Which team starts on offense?</p>
                <div className="space-y-3">
                  <button onClick={() => startOvertime('team')} className="w-full bg-green-600 text-white py-5 rounded-xl font-bold text-xl shadow-lg">{currentGame.teamName}</button>
                  <button onClick={() => startOvertime('opponent')} className="w-full bg-blue-600 text-white py-5 rounded-xl font-bold text-xl shadow-lg">{currentGame.opponentName}</button>
                </div>
              </div>
            </div>
          )}

          {/* Settings Dialog */}
          {showSettings && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
                <h3 className="text-2xl font-bold mb-6">Game Settings</h3>
                <div className="space-y-4">
                  <div>
                    <p className="font-bold mb-3">Adjust Score</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between bg-gray-50 p-3 rounded-xl">
                        <span className="font-semibold">{currentGame.teamName}</span>
                        <div className="flex gap-2">
                          <button onClick={() => adjustScore('team', -1)} className="bg-red-500 text-white w-10 h-10 rounded-lg">-</button>
                          <span className="w-12 text-center font-bold text-xl">{currentGame.score.team}</span>
                          <button onClick={() => adjustScore('team', 1)} className="bg-green-500 text-white w-10 h-10 rounded-lg">+</button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between bg-gray-50 p-3 rounded-xl">
                        <span className="font-semibold">{currentGame.opponentName}</span>
                        <div className="flex gap-2">
                          <button onClick={() => adjustScore('opponent', -1)} className="bg-red-500 text-white w-10 h-10 rounded-lg">-</button>
                          <span className="w-12 text-center font-bold text-xl">{currentGame.score.opponent}</span>
                          <button onClick={() => adjustScore('opponent', 1)} className="bg-green-500 text-white w-10 h-10 rounded-lg">+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setShowSettings(false)} className="w-full bg-gray-600 text-white py-3 rounded-xl font-bold">Close</button>
                </div>
              </div>
            </div>
          )}

          {/* End Half Dialog */}
          {showEndHalfDialog && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
                <h3 className="text-2xl font-bold mb-4">{currentGame.half === 1 ? 'End 1st Half' : 'End 2nd Half'}</h3>
                <p className="text-lg mb-6">Which team receives the ball?</p>
                <div className="space-y-3 mb-4">
                  <button onClick={() => setEndHalfPossession('team')} className={`w-full py-4 rounded-xl font-bold text-lg ${endHalfPossession === 'team' ? 'bg-green-600 text-white' : 'bg-gray-100'}`}>{currentGame.teamName}</button>
                  <button onClick={() => setEndHalfPossession('opponent')} className={`w-full py-4 rounded-xl font-bold text-lg ${endHalfPossession === 'opponent' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>{currentGame.opponentName}</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => { setShowEndHalfDialog(false); setEndHalfPossession('team'); }} className="bg-gray-600 text-white py-3 rounded-xl font-bold">Cancel</button>
                  <button onClick={() => { endHalf(endHalfPossession); setShowEndHalfDialog(false); setEndHalfPossession('team'); }} className="bg-orange-600 text-white py-3 rounded-xl font-bold">Confirm</button>
                </div>
              </div>
            </div>
          )}

          {/* Scoreboard */}
          <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
            <div className="grid grid-cols-2 gap-6">
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">{currentGame.teamName}</p>
                <p className="text-5xl font-bold text-green-600">{currentGame.score.team}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">{currentGame.opponentName}</p>
                <p className="text-5xl font-bold text-blue-600">{currentGame.score.opponent}</p>
              </div>
            </div>
            {!currentGame.awaitingOvertimeConversion && (
              <div className="bg-gray-700 rounded-xl p-4 text-center mt-4 text-white">
                <p className="text-sm text-gray-300">Possession: <span className="font-bold text-yellow-400">{isOffense ? currentGame.teamName : currentGame.opponentName}</span></p>
                <p className="text-2xl font-bold mt-1">{currentGame.down}{currentGame.down===1?'st':currentGame.down===2?'nd':currentGame.down===3?'rd':'th'} & {currentGame.yardsToGo}</p>
                <p className="text-sm text-gray-300 mt-1">Ball on {currentGame.lineOfScrimmage} → 1st: {getFirstDownTarget()}</p>
              </div>
            )}
          </div>

          {/* Overtime Conversion Mode */}
          {currentGame.awaitingOvertimeConversion ? (
            <div className="bg-gradient-to-r from-yellow-500 to-orange-500 rounded-2xl shadow-xl p-6 mb-4 text-white">
              <h3 className="text-2xl font-bold mb-2 text-center">⚡ OT Round {currentGame.overtimeRound} ⚡</h3>
              <p className="text-center mb-4">{currentGame.possession === 'team' ? currentGame.teamName : currentGame.opponentName} on Offense</p>
              <div className="bg-white rounded-xl p-4 mb-4 text-gray-800">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <button onClick={() => setOtConversionType(1)} className={`py-4 rounded-xl font-bold ${otConversionType === 1 ? 'bg-yellow-500 text-white' : 'bg-gray-100'}`}>1-Point</button>
                  <button onClick={() => setOtConversionType(2)} className={`py-4 rounded-xl font-bold ${otConversionType === 2 ? 'bg-green-500 text-white' : 'bg-gray-100'}`}>2-Point</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setOtConversionSuccess(true)} className={`py-3 rounded-xl font-bold ${otConversionSuccess ? 'bg-green-600 text-white' : 'bg-gray-100'}`}>✓ Success</button>
                  <button onClick={() => setOtConversionSuccess(false)} className={`py-3 rounded-xl font-bold ${!otConversionSuccess ? 'bg-red-600 text-white' : 'bg-gray-100'}`}>✗ Failed</button>
                </div>
              </div>
              <button onClick={() => handleOTConversion(otConversionSuccess)} className="w-full bg-white text-orange-600 py-5 rounded-xl font-bold text-xl">⚡ Record Conversion</button>
            </div>
          ) : (
            <>
              {/* Mode Selector */}
              <div className="bg-white rounded-2xl shadow-xl p-4 mb-4">
                <div className="grid grid-cols-3 gap-3">
                  <button onClick={() => setGameMode('normal')} className={`py-4 rounded-xl font-bold ${gameMode === 'normal' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Regular Play</button>
                  <button onClick={() => setGameMode('pointAfter')} className={`py-4 rounded-xl font-bold ${gameMode === 'pointAfter' ? 'bg-purple-600 text-white' : 'bg-gray-100'}`}>Point After TD</button>
                  <button onClick={() => setGameMode('penalty')} className={`py-4 rounded-xl font-bold ${gameMode === 'penalty' ? 'bg-red-600 text-white' : 'bg-gray-100'}`}>Penalty</button>
                </div>
              </div>

              {gameMode === 'normal' ? (
                <>
                  {/* Play Type */}
                  <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                    <p className="text-sm font-bold text-gray-600 mb-3">PLAY TYPE</p>
                    <div className="grid grid-cols-3 gap-3">
                      <button onClick={() => setPlayType('pass')} className={`py-4 rounded-xl font-bold ${playType === 'pass' ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}>Pass</button>
                      <button onClick={() => setPlayType('run')} className={`py-4 rounded-xl font-bold ${playType === 'run' ? 'bg-green-500 text-white' : 'bg-gray-100'}`}>Run</button>
                      <button onClick={() => setPlayType('punt')} className={`py-4 rounded-xl font-bold ${playType === 'punt' ? 'bg-orange-500 text-white' : 'bg-gray-100'}`}>Punt</button>
                    </div>
                  </div>

                  {/* Players */}
                  {playType !== 'punt' && (
                    <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                      <p className="text-sm font-bold text-gray-600 mb-3">PLAYERS</p>
                      {isOffense ? (
                        <div className="space-y-3">
                          {playType === 'pass' && (
                            <>
                              <select value={players.passer} onChange={(e) => setPlayers({...players, passer: e.target.value})} className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none">
                                <option value="">Select Passer</option>
                                {[...currentGame.roster].sort((a, b) => b.number - a.number).map(p => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
                              </select>
                              {flags.complete && (
                                <select value={players.receiver} onChange={(e) => setPlayers({...players, receiver: e.target.value})} className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 font-semibold focus:border-green-500 focus:outline-none">
                                  <option value="">Select Receiver</option>
                                  {[...currentGame.roster].sort((a, b) => b.number - a.number).map(p => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
                                </select>
                              )}
                            </>
                          )}
                          {playType === 'run' && (
                            <select value={players.rusher} onChange={(e) => setPlayers({...players, rusher: e.target.value})} className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 font-semibold focus:border-green-500 focus:outline-none">
                              <option value="">Select Rusher</option>
                              {[...currentGame.roster].sort((a, b) => b.number - a.number).map(p => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
                            </select>
                          )}
                        </div>
                      ) : (
                        <select value={players.defender} onChange={(e) => setPlayers({...players, defender: e.target.value})} className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 font-semibold focus:border-purple-500 focus:outline-none">
                          <option value="">Select Defender</option>
                          {[...currentGame.roster].sort((a, b) => b.number - a.number).map(p => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
                        </select>
                      )}
                    </div>
                  )}

                  {/* Yards */}
                  {playType !== 'punt' && (
                    <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                      <p className="text-sm font-bold text-gray-600 mb-3">YARDS</p>
                      <div className="max-w-xl mx-auto">
                        <div className="flex gap-2 mb-4 items-center">
                          <button onClick={() => setYards(Math.max(-20, yards - 5))} className="bg-red-500 text-white px-4 py-3 rounded-xl font-bold text-sm flex-shrink-0">-5</button>
                          <button onClick={() => setYards(Math.max(-20, yards - 1))} className="bg-red-400 text-white px-4 py-3 rounded-xl font-bold text-sm flex-shrink-0">-1</button>
                          <input type="number" value={yards} onChange={(e) => setYards(parseInt(e.target.value) || 0)} className="flex-1 min-w-0 border-2 rounded-xl px-2 py-3 text-center text-2xl font-bold" />
                          <button onClick={() => setYards(Math.min(60, yards + 1))} className="bg-green-400 text-white px-4 py-3 rounded-xl font-bold text-sm flex-shrink-0">+1</button>
                          <button onClick={() => setYards(Math.min(60, yards + 5))} className="bg-green-500 text-white px-4 py-3 rounded-xl font-bold text-sm flex-shrink-0">+5</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[10, 15, 20, 25, 30, 40].map(y => <button key={y} onClick={() => setYards(y)} className="bg-gray-100 py-2 rounded-lg font-semibold">{y}</button>)}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Outcome Flags */}
                  {playType !== 'punt' && (
                    <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                      <p className="text-sm font-bold text-gray-600 mb-3">OUTCOME</p>
                      <div className="grid grid-cols-2 gap-3">
                        {playType === 'pass' && isOffense && <button onClick={() => setFlags({...flags, complete: !flags.complete})} className={`py-3 rounded-xl font-bold ${flags.complete ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>{flags.complete ? '✓ Complete' : '✗ Incomplete'}</button>}
                        {!isOffense && <button onClick={() => setFlags({...flags, flagPull: !flags.flagPull})} className={`py-3 rounded-xl font-bold ${flags.flagPull ? 'bg-purple-600 text-white' : 'bg-gray-100'}`}>Flag Pull</button>}
                        <button onClick={() => setFlags({...flags, firstDown: !flags.firstDown})} className={`py-3 rounded-xl font-bold ${flags.firstDown ? 'bg-yellow-500 text-white' : 'bg-gray-100'}`}>1st Down</button>
                        <button onClick={() => { const newTD = !flags.touchdown; setFlags({...flags, touchdown: newTD, flagPull: !isOffense && newTD ? false : flags.flagPull}); }} className={`py-3 rounded-xl font-bold ${flags.touchdown ? 'bg-green-600 text-white' : 'bg-gray-100'}`}>Touchdown</button>
                        {isOffense && <button onClick={() => setFlags({...flags, interception: !flags.interception})} className={`py-3 rounded-xl font-bold ${flags.interception ? 'bg-red-600 text-white' : 'bg-gray-100'}`}>Interception</button>}
                        {isOffense && <button onClick={() => setFlags({...flags, safety: !flags.safety})} className={`py-3 rounded-xl font-bold ${flags.safety ? 'bg-purple-600 text-white' : 'bg-gray-100'}`}>Safety</button>}
                        {!isOffense && <button onClick={() => { const newINT = !flags.interception; setFlags({...flags, interception: newINT, flagPull: newINT ? false : flags.flagPull}); }} className={`py-3 rounded-xl font-bold ${flags.interception ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Interception</button>}
                        {!isOffense && playType === 'pass' && <button onClick={() => setFlags({...flags, incomplete: !flags.incomplete})} className={`py-3 rounded-xl font-bold ${flags.incomplete ? 'bg-red-500 text-white' : 'bg-gray-100'}`}>Incomplete</button>}
                        {!isOffense && playType === 'pass' && <button onClick={() => setFlags({...flags, passDeflection: !flags.passDeflection})} className={`py-3 rounded-xl font-bold ${flags.passDeflection ? 'bg-orange-600 text-white' : 'bg-gray-100'}`}>Pass Deflection</button>}
                      </div>
                    </div>
                  )}
                </>
              ) : gameMode === 'pointAfter' ? (
                <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                  <p className="text-sm font-bold text-gray-600 mb-3">POINT AFTER</p>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <button onClick={() => setPointAfterType(1)} className={`py-4 rounded-xl font-bold ${pointAfterType === 1 ? 'bg-yellow-500 text-white' : 'bg-gray-100'}`}>1-Point Kick</button>
                    <button onClick={() => setPointAfterType(2)} className={`py-4 rounded-xl font-bold ${pointAfterType === 2 ? 'bg-green-500 text-white' : 'bg-gray-100'}`}>2-Point Try</button>
                  </div>
                  {pointAfterType === 2 && (
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => setPointAfterSuccess(true)} className={`py-3 rounded-xl font-bold ${pointAfterSuccess ? 'bg-green-600 text-white' : 'bg-gray-100'}`}>✓ Success</button>
                      <button onClick={() => setPointAfterSuccess(false)} className={`py-3 rounded-xl font-bold ${!pointAfterSuccess ? 'bg-red-600 text-white' : 'bg-gray-100'}`}>✗ Failed</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                  <p className="text-sm font-bold text-gray-600 mb-3">PENALTY</p>
                  <div className="mb-4">
                    <p className="text-sm font-bold text-gray-700 mb-2">Penalty On:</p>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => setPenaltyOnOffense(true)} className={`py-3 rounded-xl font-bold ${penaltyOnOffense ? 'bg-red-600 text-white' : 'bg-gray-100'}`}>Offense</button>
                      <button onClick={() => setPenaltyOnOffense(false)} className={`py-3 rounded-xl font-bold ${!penaltyOnOffense ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Defense</button>
                    </div>
                  </div>
                  <div className="mb-4">
                    <p className="text-sm font-bold text-gray-700 mb-2">Penalty Yards:</p>
                    <div className="flex gap-3 mb-3">
                      <button onClick={() => setPenaltyYards(Math.max(0, penaltyYards - 5))} className="bg-gray-300 px-4 py-2 rounded-lg font-bold">-5</button>
                      <input type="number" value={penaltyYards} onChange={(e) => setPenaltyYards(Math.max(0, parseInt(e.target.value) || 0))} className="flex-1 border-2 rounded-xl px-4 py-3 text-center text-2xl font-bold" />
                      <button onClick={() => setPenaltyYards(penaltyYards + 5)} className="bg-gray-300 px-4 py-2 rounded-lg font-bold">+5</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[5, 10, 15].map(y => <button key={y} onClick={() => setPenaltyYards(y)} className="bg-gray-100 py-2 rounded-lg font-semibold">{y}</button>)}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-700 mb-2">Down Status:</p>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => setPenaltyLossOfDown(false)} className={`py-3 rounded-xl font-bold ${!penaltyLossOfDown ? 'bg-yellow-600 text-white' : 'bg-gray-100'}`}>Replay Down</button>
                      <button onClick={() => setPenaltyLossOfDown(true)} className={`py-3 rounded-xl font-bold ${penaltyLossOfDown ? 'bg-orange-600 text-white' : 'bg-gray-100'}`}>Loss of Down</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Record Button */}
              <button onClick={recordPlay} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-bold text-xl shadow-2xl mb-4">
                {gameMode === 'pointAfter' ? '🏈 Record Point After' : gameMode === 'penalty' ? '🚩 Record Penalty' : playType === 'punt' ? '👟 Punt' : '✓ Record Play'}
              </button>
            </>
          )}

          {/* Bottom Nav */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 p-4 grid grid-cols-4 gap-3 max-w-4xl mx-auto">
            <button onClick={undoLastPlay} className="bg-orange-600 text-white py-3 rounded-xl font-bold">Undo</button>
            <button onClick={() => setShowSettings(true)} className="bg-gray-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2">⚙️Settings</button>
            <button onClick={() => setView('stats')} className="bg-purple-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2">📊Stats</button>
            <button onClick={() => currentGame.half === 1 ? setShowEndHalfDialog(true) : endGame()} className="bg-red-600 text-white py-3 rounded-xl font-bold">{currentGame.half === 1 ? 'End Half' : 'End Game'}</button>
          </div>
        </div>
      )}
      
      {view === 'stats' && currentGame && (
        <div className="p-6 max-w-4xl mx-auto pb-24">
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl shadow-2xl p-6 mb-6 text-white">
            <h2 className="text-3xl font-bold mb-2">Game Statistics</h2>
            <p className="text-lg">{currentGame.teamName} vs {currentGame.opponentName}</p>
            <p className="text-4xl font-bold mt-3">{currentGame.score.team} - {currentGame.score.opponent}</p>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button onClick={() => setStatsView('team')} className={`py-3 rounded-xl font-bold transition ${statsView === 'team' ? 'bg-white text-purple-600' : 'bg-purple-700'}`}>Team Stats</button>
              <button onClick={() => setStatsView('players')} className={`py-3 rounded-xl font-bold transition ${statsView === 'players' ? 'bg-white text-purple-600' : 'bg-purple-700'}`}>Player Stats</button>
            </div>
          </div>

          {statsView === 'team' ? (
            <>
              <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">🏁Offense</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Total Plays</p><p className="text-3xl font-bold text-gray-800">{currentGame.stats.offense.totalPlays}</p></div>
                  <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">1st Downs</p><p className="text-3xl font-bold text-gray-800">{currentGame.stats.offense.firstDowns}</p></div>
                  <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Touchdowns</p><p className="text-3xl font-bold text-green-600">{currentGame.stats.offense.touchdowns}</p></div>
                  <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Pass Yards</p><p className="text-3xl font-bold text-gray-800">{currentGame.stats.offense.passingYards}</p></div>
                  <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Rush Yards</p><p className="text-3xl font-bold text-gray-800">{currentGame.stats.offense.rushingYards}</p></div>
                  <div className="bg-gradient-to-r from-blue-50 to-green-50 border-2 border-green-500 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Total Yards</p><p className="text-3xl font-bold text-green-600">{currentGame.stats.offense.passingYards + currentGame.stats.offense.rushingYards}</p></div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">🏁Defense</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Flag Pulls</p><p className="text-3xl font-bold text-gray-800">{currentGame.stats.defense.flagPulls}</p></div>
                  <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Interceptions</p><p className="text-3xl font-bold text-blue-600">{currentGame.stats.defense.interceptions}</p></div>
                </div>
              </div>
            </>
          ) : (
            <>
              {Object.values(currentGame.playerStats || {}).filter(p => p.offense.passAttempts > 0).length > 0 && (
                <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                  <h3 className="text-xl font-bold text-gray-800 mb-4">Passing</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr><th className="text-left p-3 font-bold text-gray-700">Player</th><th className="text-left p-3 font-bold text-gray-700">CMP</th><th className="text-left p-3 font-bold text-gray-700">ATT</th><th className="text-left p-3 font-bold text-gray-700">YDS</th><th className="text-left p-3 font-bold text-gray-700">TD</th><th className="text-left p-3 font-bold text-gray-700">INT</th></tr>
                      </thead>
                      <tbody>
                        {Object.values(currentGame.playerStats || {}).filter(p => p.offense.passAttempts > 0).map((player, i) => (
                          <tr key={i} className="border-b border-gray-100"><td className="p-3 font-semibold">#{player.number} {player.name}</td><td className="p-3 font-semibold">{player.offense.completions}</td><td className="p-3 font-semibold">{player.offense.passAttempts}</td><td className="p-3 font-semibold">{player.offense.passingYards}</td><td className="p-3 font-semibold">{player.offense.touchdowns}</td><td className="p-3 font-semibold">{player.offense.interceptions}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {Object.values(currentGame.playerStats || {}).filter(p => p.offense.rushAttempts > 0).length > 0 && (
                <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                  <h3 className="text-xl font-bold text-gray-800 mb-4">Rushing</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr><th className="text-left p-3 font-bold text-gray-700">Player</th><th className="text-left p-3 font-bold text-gray-700">ATT</th><th className="text-left p-3 font-bold text-gray-700">YDS</th><th className="text-left p-3 font-bold text-gray-700">TD</th></tr>
                      </thead>
                      <tbody>
                        {Object.values(currentGame.playerStats || {}).filter(p => p.offense.rushAttempts > 0).map((player, i) => (
                          <tr key={i} className="border-b border-gray-100"><td className="p-3 font-semibold">#{player.number} {player.name}</td><td className="p-3 font-semibold">{player.offense.rushAttempts}</td><td className="p-3 font-semibold">{player.offense.rushingYards}</td><td className="p-3 font-semibold">{player.offense.touchdowns}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {Object.values(currentGame.playerStats || {}).filter(p => p.offense.receptions > 0).length > 0 && (
                <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                  <h3 className="text-xl font-bold text-gray-800 mb-4">Receiving</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr><th className="text-left p-3 font-bold text-gray-700">Player</th><th className="text-left p-3 font-bold text-gray-700">REC</th><th className="text-left p-3 font-bold text-gray-700">YDS</th><th className="text-left p-3 font-bold text-gray-700">TD</th></tr>
                      </thead>
                      <tbody>
                        {Object.values(currentGame.playerStats || {}).filter(p => p.offense.receptions > 0).map((player, i) => (
                          <tr key={i} className="border-b border-gray-100"><td className="p-3 font-semibold">#{player.number} {player.name}</td><td className="p-3 font-semibold">{player.offense.receptions}</td><td className="p-3 font-semibold">{player.offense.receivingYards}</td><td className="p-3 font-semibold">{player.offense.touchdowns}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {Object.values(currentGame.playerStats || {}).filter(p => p.defense.flagPulls > 0 || p.defense.interceptions > 0 || p.defense.tacklesForLoss > 0 || p.defense.passDeflections > 0).length > 0 && (
                <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
                  <h3 className="text-xl font-bold text-gray-800 mb-4">Defense</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr><th className="text-left p-3 font-bold text-gray-700">Player</th><th className="text-left p-3 font-bold text-gray-700">Tackles</th><th className="text-left p-3 font-bold text-gray-700">TFL</th><th className="text-left p-3 font-bold text-gray-700">INT</th><th className="text-left p-3 font-bold text-gray-700">PD</th></tr>
                      </thead>
                      <tbody>
                        {Object.values(currentGame.playerStats || {}).filter(p => p.defense.flagPulls > 0 || p.defense.interceptions > 0 || p.defense.tacklesForLoss > 0 || p.defense.passDeflections > 0).map((player, i) => (
                          <tr key={i} className="border-b border-gray-100"><td className="p-3 font-semibold">#{player.number} {player.name}</td><td className="p-3 font-semibold">{player.defense.flagPulls}</td><td className="p-3 font-semibold">{player.defense.tacklesForLoss || 0}</td><td className="p-3 font-semibold">{player.defense.interceptions}</td><td className="p-3 font-semibold">{player.defense.passDeflections || 0}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {Object.values(currentGame.playerStats || {}).filter(p => p.offense.passAttempts > 0 || p.offense.rushAttempts > 0 || p.offense.receptions > 0 || p.defense.flagPulls > 0 || p.defense.interceptions > 0 || p.defense.tacklesForLoss > 0 || p.defense.passDeflections > 0).length === 0 && (
                <div className="bg-white rounded-xl shadow p-12 text-center">
                  <p className="text-gray-500 text-lg">No player stats recorded yet. Start tracking plays in the game!</p>
                </div>
              )}
            </>
          )}

          <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-200 p-4 grid grid-cols-4 gap-3 max-w-4xl mx-auto">
            <button onClick={() => setView('home')} className="bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 rounded-xl font-bold hover:from-blue-700 hover:to-blue-800">Home</button>
            <button onClick={() => setView('game')} className="bg-gradient-to-r from-gray-600 to-gray-700 text-white py-3 rounded-xl font-bold hover:from-gray-700 hover:to-gray-800">Back</button>
            <button onClick={() => downloadCSV(currentGame)} className="bg-gradient-to-r from-green-600 to-green-700 text-white py-3 rounded-xl font-bold hover:from-green-700 hover:to-green-800 flex items-center justify-center gap-2">⬇️CSV</button>
            <button onClick={() => emailCSV(currentGame)} className="bg-gradient-to-r from-orange-600 to-orange-700 text-white py-3 rounded-xl font-bold hover:from-orange-700 hover:to-orange-800 flex items-center justify-center gap-2">✉️Email</button>
          </div>
        </div>
      )}
      
      {view === 'season' && (
        <div className="p-6 max-w-4xl mx-auto pb-24">
          <div className="bg-gradient-to-r from-yellow-400 to-orange-500 rounded-2xl shadow-2xl p-6 mb-6 text-gray-900">
            <h2 className="text-3xl font-bold mb-2">Season Statistics</h2>
            <p className="text-xl font-bold mt-3">
              Record: {seasonStats.teamStats.wins || 0}-{seasonStats.teamStats.losses || 0}{(seasonStats.teamStats.ties || 0) > 0 ? `-${seasonStats.teamStats.ties}` : ''}
            </p>
            <p className="text-lg mt-1">Games Played: {seasonStats.teamStats.gamesPlayed || 0}</p>
          </div>

          {/* Team Stats - Offense */}
          {seasonStats.teamStats.offense && (
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
              <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">🏁Team Offense</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Total Plays</p><p className="text-3xl font-bold text-gray-800">{seasonStats.teamStats.offense.totalPlays}</p></div>
                <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">1st Downs</p><p className="text-3xl font-bold text-gray-800">{seasonStats.teamStats.offense.firstDowns}</p></div>
                <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Touchdowns</p><p className="text-3xl font-bold text-green-600">{seasonStats.teamStats.offense.touchdowns}</p></div>
                <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Pass Yards</p><p className="text-3xl font-bold text-gray-800">{seasonStats.teamStats.offense.passingYards}</p></div>
                <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Rush Yards</p><p className="text-3xl font-bold text-gray-800">{seasonStats.teamStats.offense.rushingYards}</p></div>
                <div className="bg-gradient-to-r from-blue-50 to-green-50 border-2 border-green-500 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Total Yards</p><p className="text-3xl font-bold text-green-600">{seasonStats.teamStats.offense.passingYards + seasonStats.teamStats.offense.rushingYards}</p></div>
              </div>
            </div>
          )}

          {/* Team Stats - Defense */}
          {seasonStats.teamStats.defense && (
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
              <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">🏁Team Defense</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Flag Pulls</p><p className="text-3xl font-bold text-gray-800">{seasonStats.teamStats.defense.flagPulls}</p></div>
                <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Interceptions</p><p className="text-3xl font-bold text-blue-600">{seasonStats.teamStats.defense.interceptions}</p></div>
                <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Forced Punts</p><p className="text-3xl font-bold text-gray-800">{seasonStats.teamStats.defense.forcedPunts || 0}</p></div>
                <div className="bg-gray-50 p-4 rounded-xl"><p className="text-sm text-gray-600 font-semibold">Turnovers on Downs</p><p className="text-3xl font-bold text-gray-800">{seasonStats.teamStats.defense.turnoversOnDowns || 0}</p></div>
              </div>
            </div>
          )}

          {/* Season Player Stats - Passing */}
          {Object.values(seasonStats.playerStats || {}).filter(p => p.offense.passAttempts > 0).length > 0 && (
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Season Leaders - Passing</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr><th className="text-left p-3 font-bold text-gray-700">Player</th><th className="text-left p-3 font-bold text-gray-700">CMP</th><th className="text-left p-3 font-bold text-gray-700">ATT</th><th className="text-left p-3 font-bold text-gray-700">YDS</th><th className="text-left p-3 font-bold text-gray-700">TD</th><th className="text-left p-3 font-bold text-gray-700">INT</th></tr>
                  </thead>
                  <tbody>
                    {Object.values(seasonStats.playerStats || {}).filter(p => p.offense.passAttempts > 0).map((player, i) => (
                      <tr key={i} className="border-b border-gray-100"><td className="p-3 font-semibold">#{player.number} {player.name}</td><td className="p-3 font-semibold">{player.offense.completions}</td><td className="p-3 font-semibold">{player.offense.passAttempts}</td><td className="p-3 font-semibold">{player.offense.passingYards}</td><td className="p-3 font-semibold">{player.offense.touchdowns}</td><td className="p-3 font-semibold">{player.offense.interceptions}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Season Player Stats - Rushing */}
          {Object.values(seasonStats.playerStats || {}).filter(p => p.offense.rushAttempts > 0).length > 0 && (
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Season Leaders - Rushing</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr><th className="text-left p-3 font-bold text-gray-700">Player</th><th className="text-left p-3 font-bold text-gray-700">ATT</th><th className="text-left p-3 font-bold text-gray-700">YDS</th><th className="text-left p-3 font-bold text-gray-700">TD</th></tr>
                  </thead>
                  <tbody>
                    {Object.values(seasonStats.playerStats || {}).filter(p => p.offense.rushAttempts > 0).map((player, i) => (
                      <tr key={i} className="border-b border-gray-100"><td className="p-3 font-semibold">#{player.number} {player.name}</td><td className="p-3 font-semibold">{player.offense.rushAttempts}</td><td className="p-3 font-semibold">{player.offense.rushingYards}</td><td className="p-3 font-semibold">{player.offense.touchdowns}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Season Player Stats - Receiving */}
          {Object.values(seasonStats.playerStats || {}).filter(p => p.offense.receptions > 0).length > 0 && (
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Season Leaders - Receiving</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr><th className="text-left p-3 font-bold text-gray-700">Player</th><th className="text-left p-3 font-bold text-gray-700">REC</th><th className="text-left p-3 font-bold text-gray-700">YDS</th><th className="text-left p-3 font-bold text-gray-700">TD</th></tr>
                  </thead>
                  <tbody>
                    {Object.values(seasonStats.playerStats || {}).filter(p => p.offense.receptions > 0).map((player, i) => (
                      <tr key={i} className="border-b border-gray-100"><td className="p-3 font-semibold">#{player.number} {player.name}</td><td className="p-3 font-semibold">{player.offense.receptions}</td><td className="p-3 font-semibold">{player.offense.receivingYards}</td><td className="p-3 font-semibold">{player.offense.touchdowns}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Season Player Stats - Defense */}
          {Object.values(seasonStats.playerStats || {}).filter(p => p.defense.flagPulls > 0 || p.defense.interceptions > 0 || p.defense.tacklesForLoss > 0 || p.defense.passDeflections > 0).length > 0 && (
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Season Leaders - Defense</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr><th className="text-left p-3 font-bold text-gray-700">Player</th><th className="text-left p-3 font-bold text-gray-700">Tackles</th><th className="text-left p-3 font-bold text-gray-700">TFL</th><th className="text-left p-3 font-bold text-gray-700">INT</th><th className="text-left p-3 font-bold text-gray-700">PD</th></tr>
                  </thead>
                  <tbody>
                    {Object.values(seasonStats.playerStats || {}).filter(p => p.defense.flagPulls > 0 || p.defense.interceptions > 0 || p.defense.tacklesForLoss > 0 || p.defense.passDeflections > 0).map((player, i) => (
                      <tr key={i} className="border-b border-gray-100"><td className="p-3 font-semibold">#{player.number} {player.name}</td><td className="p-3 font-semibold">{player.defense.flagPulls}</td><td className="p-3 font-semibold">{player.defense.tacklesForLoss || 0}</td><td className="p-3 font-semibold">{player.defense.interceptions}</td><td className="p-3 font-semibold">{player.defense.passDeflections || 0}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mt-4">
            <button onClick={exportSeasonCSV} className="bg-green-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-green-700 flex items-center justify-center gap-2">
              ⬇️
              Export CSV
            </button>
            <button onClick={() => setView('home')} className="bg-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-blue-700">Back to Home</button>
          </div>
        </div>
      )}

      {/* Import Season Dialog - at root level so it shows from any view */}
      {showImportDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full">
            <h3 className="text-2xl font-bold mb-4 text-purple-600">📥 Import Season</h3>
            <p className="text-gray-700 mb-4">Upload a previously exported season file (.json) to restore your data.</p>
            <div className="mb-4">
              <label className="block text-sm font-bold text-gray-700 mb-2">Select Season File</label>
              <input 
                type="file" 
                accept=".json"
                onChange={handleFileUpload}
                className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 focus:border-purple-500 focus:outline-none"
              />
            </div>
            {importData && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl">
                <p className="text-sm text-green-700 font-semibold">✓ File loaded successfully</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { setShowImportDialog(false); setImportData(''); }} className="bg-gray-600 text-white py-4 rounded-xl font-bold hover:bg-gray-700">Cancel</button>
              <button onClick={importSeason} disabled={!importData} className={`py-4 rounded-xl font-bold ${importData ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Game Confirmation Dialog - at root level so it shows from any view */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <h3 className="text-2xl font-bold mb-4 text-red-600">⚠️ Delete Game</h3>
            <p className="text-lg mb-6">Are you sure you want to delete this game? This will also remove all stats from your season totals. This action cannot be undone.</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { setShowDeleteConfirm(false); setGameToDelete(null); }} className="bg-gray-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-gray-700">Cancel</button>
              <button onClick={confirmDeleteGame} className="bg-red-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-700">Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Render the app
const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);
root.render(React.createElement(FlagFootballTracker));
