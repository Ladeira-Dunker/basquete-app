(() => {
  const config = window.QUADRA_SUPABASE_CONFIG;
  const unconfigured = document.querySelector("#community-unconfigured");
  const authPanel = document.querySelector("#community-auth-panel");
  const dashboard = document.querySelector("#community-dashboard");
  const status = document.querySelector("#community-status");
  const teamSelect = document.querySelector("#community-team-select");
  const teamView = document.querySelector("#community-team-view");
  const inviteOutput = document.querySelector("#community-invite-output");
  const inviteLink = document.querySelector("#community-invite-link");
  const membersList = document.querySelector("#community-members");
  const sharedStats = document.querySelector("#community-shared-stats");
  const signInForm = document.querySelector("#community-signin-form");
  const signUpForm = document.querySelector("#community-signup-form");
  const teamForm = document.querySelector("#community-team-form");
  const shareForm = document.querySelector("#community-share-form");
  const shareCheckbox = document.querySelector("#community-share-stats");

  if (
    !config ||
    typeof config.url !== "string" ||
    !config.url.startsWith("https://") ||
    typeof config.anonKey !== "string" ||
    !config.anonKey.trim()
  ) {
    unconfigured.hidden = false;
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    unconfigured.hidden = false;
    unconfigured.querySelector("strong").textContent = "Não foi possível carregar a conexão online.";
    unconfigured.querySelector("p").textContent =
      "Confira a conexão com a internet e recarregue a página para acessar a comunidade.";
    return;
  }

  let client;
  try {
    client = window.supabase.createClient(config.url, config.anonKey);
  } catch (error) {
    console.error("Supabase initialization failed:", error);
    unconfigured.hidden = false;
    unconfigured.querySelector("strong").textContent = "A configuração da comunidade é inválida.";
    unconfigured.querySelector("p").textContent =
      "Confira a URL e a chave pública do Supabase em supabase-config.js.";
    return;
  }

  let currentUser = null;
  let teams = [];
  let selectedTeam = null;
  let activeInviteId = null;
  let pendingInviteToken = null;

  const currentUrl = new URL(window.location.href);
  const inviteFromUrl = currentUrl.searchParams.get("invite");
  if (inviteFromUrl) {
    if (/^[A-Za-z0-9_-]{40,60}$/.test(inviteFromUrl)) {
      pendingInviteToken = inviteFromUrl;
    } else {
      status.textContent = "Este link de convite parece inválido.";
    }
    currentUrl.searchParams.delete("invite");
    window.history.replaceState(null, "", currentUrl);
  }

  function showError(action, error) {
    console.error(`${action}:`, error);
    status.textContent = `${action}: ${error.message || "erro inesperado."}`;
  }

  function getError(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  function addText(parent, tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    parent.append(element);
    return element;
  }

  function formatAverage(total, count) {
    return count ? (total / count).toFixed(1) : "0.0";
  }

  function readLocalGameTotals() {
    let entries;
    try {
      const saved = localStorage.getItem("quadra-game-history");
      entries = saved ? JSON.parse(saved) : [];
    } catch (error) {
      throw new Error(`Não foi possível ler o histórico local de partidas: ${error.message}`);
    }

    if (!Array.isArray(entries)) {
      throw new Error("O histórico local de partidas está em um formato inválido.");
    }

    const fields = [
      "minutes", "points", "rebounds", "assists", "steals", "blocks", "turnovers",
      "fgMade", "fgAttempted", "threeMade", "threeAttempted", "ftMade", "ftAttempted"
    ];
    const totals = { games_played: entries.length };
    fields.forEach((field) => {
      totals[`${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_total`] = 0;
    });

    entries.forEach((entry) => {
      if (!entry || fields.some((field) =>
        !Number.isInteger(entry[field]) || entry[field] < 0
      )) {
        throw new Error("Uma partida salva está incompleta. Corrija ou remova o registro antes de compartilhar.");
      }
      fields.forEach((field) => {
        const totalKey = `${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_total`;
        totals[totalKey] += entry[field];
      });
    });
    return totals;
  }

  async function syncSharedStats(teamIds) {
    if (!currentUser || teamIds.length === 0) return;
    const totals = readLocalGameTotals();
    const rows = teamIds.map((teamId) => ({
      ...totals,
      team_id: teamId,
      user_id: currentUser.id,
      updated_at: new Date().toISOString()
    }));
    getError(await client.from("shared_game_stats").upsert(rows, {
      onConflict: "team_id,user_id"
    }));
  }

  async function syncAllSharedStats() {
    if (!currentUser) return;
    const memberships = getError(await client
      .from("team_members")
      .select("team_id")
      .eq("user_id", currentUser.id)
      .eq("share_stats", true));
    if (memberships.length) {
      await syncSharedStats(memberships.map((membership) => membership.team_id));
    }
  }

  function renderTeamOptions() {
    teamSelect.replaceChildren();
    if (teams.length === 0) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Nenhum time encontrado";
      teamSelect.append(emptyOption);
      teamView.hidden = true;
      return;
    }

    teams.forEach((team) => {
      const option = document.createElement("option");
      option.value = team.id;
      option.textContent = team.name;
      teamSelect.append(option);
    });
    if (selectedTeam && teams.some((team) => team.id === selectedTeam.id)) {
      teamSelect.value = selectedTeam.id;
    } else {
      selectedTeam = teams[0];
      teamSelect.value = selectedTeam.id;
    }
  }

  async function renderMembers() {
    const memberships = getError(await client
      .from("team_members")
      .select("user_id, role, share_stats")
      .eq("team_id", selectedTeam.id)
      .order("joined_at"));
    const userIds = memberships.map((membership) => membership.user_id);
    let profiles = [];
    if (userIds.length) {
      profiles = getError(await client
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds));
    }

    membersList.replaceChildren();
    memberships.forEach((membership) => {
      const profile = profiles.find((item) => item.id === membership.user_id);
      const role = membership.role === "coach" ? "Treinador" : "Jogador";
      const item = document.createElement("li");
      item.className = "community-card";
      addText(item, "strong", profile ? profile.display_name : "Jogador");
      addText(item, "p", role);
      membersList.append(item);
    });

    const ownMembership = memberships.find((membership) => membership.user_id === currentUser.id);
    shareCheckbox.checked = Boolean(ownMembership && ownMembership.share_stats);
    const stats = getError(await client
      .from("shared_game_stats")
      .select("user_id, games_played, minutes_total, points_total, rebounds_total, assists_total, steals_total, blocks_total, turnovers_total, fg_made_total, fg_attempted_total, three_made_total, three_attempted_total, ft_made_total, ft_attempted_total")
      .eq("team_id", selectedTeam.id));
    sharedStats.replaceChildren();
    if (stats.length === 0) {
      addText(sharedStats, "p", "Nenhum jogador compartilhou estatísticas com este time.", "help");
      return;
    }
    stats.forEach((entry) => {
      const profile = profiles.find((item) => item.id === entry.user_id);
      const card = document.createElement("article");
      card.className = "community-card";
      addText(card, "h3", profile ? profile.display_name : "Jogador");
      addText(card, "p",
        `${entry.games_played} partidas · ${formatAverage(entry.points_total, entry.games_played)} pts · ` +
        `${formatAverage(entry.rebounds_total, entry.games_played)} reb · ` +
        `${formatAverage(entry.assists_total, entry.games_played)} ast por jogo`);
      addText(card, "p",
        `Arremessos: ${entry.fg_made_total}/${entry.fg_attempted_total} · ` +
        `3 pts: ${entry.three_made_total}/${entry.three_attempted_total} · ` +
        `LL: ${entry.ft_made_total}/${entry.ft_attempted_total} · ` +
        `${entry.minutes_total} min no total`);
      sharedStats.append(card);
    });
  }

  async function showSelectedTeam() {
    if (!selectedTeam) {
      teamView.hidden = true;
      return;
    }
    teamView.hidden = false;
    document.querySelector("#community-team-heading").textContent = selectedTeam.name;
    document.querySelector("#community-team-role").textContent =
      selectedTeam.role === "coach" ? "Você é treinador deste time." : "Você faz parte deste time como jogador.";
    document.querySelector("#community-coach-tools").hidden = selectedTeam.role !== "coach";
    inviteOutput.hidden = true;
    activeInviteId = null;
    try {
      await renderMembers();
      status.textContent = "";
    } catch (error) {
      showError("Não foi possível carregar o elenco e as estatísticas", error);
    }
  }

  async function loadTeams(preferredTeamId) {
    const memberships = getError(await client
      .from("team_members")
      .select("team_id, role, share_stats")
      .eq("user_id", currentUser.id));
    if (memberships.length === 0) {
      teams = [];
      selectedTeam = null;
      renderTeamOptions();
      status.textContent = "Você ainda não faz parte de um time. Crie um ou abra um link de convite.";
      return;
    }
    const teamIds = memberships.map((membership) => membership.team_id);
    const teamRows = getError(await client
      .from("teams")
      .select("id, name")
      .in("id", teamIds));
    teams = teamRows.map((team) => {
      const membership = memberships.find((item) => item.team_id === team.id);
      return { ...team, role: membership.role, shareStats: membership.share_stats };
    });
    selectedTeam = teams.find((team) => team.id === preferredTeamId) || teams[0] || null;
    renderTeamOptions();
    await showSelectedTeam();
  }

  async function joinPendingInvite() {
    if (!pendingInviteToken || !currentUser) return;
    try {
      getError(await client.rpc("join_team_by_invite", {
        p_token: pendingInviteToken
      }));
      pendingInviteToken = null;
      await loadTeams();
      status.textContent = "Você entrou no time pelo convite.";
    } catch (error) {
      showError("Não foi possível entrar pelo convite", error);
    }
  }

  async function showSignedIn(user) {
    currentUser = user;
    authPanel.hidden = true;
    dashboard.hidden = false;
    document.querySelector("#community-user-label").textContent =
      `Conectado como ${user.email || "jogador"}.`;
    try {
      await loadTeams();
      await joinPendingInvite();
      await syncAllSharedStats();
    } catch (error) {
      showError("Não foi possível carregar sua comunidade", error);
    }
  }

  signInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "Entrando...";
    const formData = new FormData(signInForm);
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: formData.get("email"),
        password: formData.get("password")
      });
      if (error) throw error;
      if (data.user) await showSignedIn(data.user);
    } catch (error) {
      showError("Não foi possível entrar", error);
    }
  });

  signUpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "Criando conta...";
    const formData = new FormData(signUpForm);
    try {
      const emailRedirectUrl = new URL(window.location.pathname, window.location.origin);
      if (pendingInviteToken) {
        emailRedirectUrl.searchParams.set("invite", pendingInviteToken);
      }
      const { data, error } = await client.auth.signUp({
        email: formData.get("email"),
        password: formData.get("password"),
        options: {
          data: { display_name: formData.get("displayName").trim() },
          emailRedirectTo: emailRedirectUrl.toString()
        }
      });
      if (error) throw error;
      if (data.session && data.user) {
        await showSignedIn(data.user);
      } else {
        status.textContent = "Conta criada. Confirme seu e-mail pelo link enviado para entrar na comunidade.";
      }
    } catch (error) {
      showError("Não foi possível criar a conta", error);
    }
  });

  document.querySelector("#community-signout").addEventListener("click", async () => {
    try {
      getError(await client.auth.signOut());
      currentUser = null;
      teams = [];
      selectedTeam = null;
      dashboard.hidden = true;
      authPanel.hidden = false;
      status.textContent = "Você saiu da comunidade.";
    } catch (error) {
      showError("Não foi possível sair da conta", error);
    }
  });

  teamForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "Criando time...";
    const formData = new FormData(teamForm);
    try {
      const teamId = getError(await client.rpc("create_team", {
        p_name: formData.get("name").trim()
      }));
      teamForm.reset();
      await loadTeams(teamId);
      status.textContent = "Time criado. Agora você pode convidar os jogadores.";
    } catch (error) {
      showError("Não foi possível criar o time", error);
    }
  });

  teamSelect.addEventListener("change", async () => {
    selectedTeam = teams.find((team) => team.id === teamSelect.value) || null;
    await showSelectedTeam();
  });

  document.querySelector("#community-refresh").addEventListener("click", async () => {
    if (!currentUser) return;
    try {
      await loadTeams(selectedTeam && selectedTeam.id);
      status.textContent = "Comunidade atualizada.";
    } catch (error) {
      showError("Não foi possível atualizar a comunidade", error);
    }
  });

  document.querySelector("#community-create-invite").addEventListener("click", async () => {
    if (!selectedTeam) return;
    status.textContent = "Criando convite...";
    try {
      const invite = getError(await client.rpc("create_team_invite", {
        p_team_id: selectedTeam.id
      }));
      if (!invite || typeof invite.id !== "string" || typeof invite.token !== "string") {
        throw new Error("A resposta do Supabase não contém um convite válido.");
      }
      activeInviteId = invite.id;
      inviteLink.value =
        `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(invite.token)}`;
      inviteOutput.hidden = false;
      status.textContent = "Convite criado. Ele expira em 14 dias; criar outro revoga o anterior.";
    } catch (error) {
      showError("Não foi possível criar o convite", error);
    }
  });

  document.querySelector("#community-copy-invite").addEventListener("click", async () => {
    if (!inviteLink.value) return;
    try {
      if (!navigator.clipboard) throw new Error("A cópia automática não está disponível neste navegador.");
      await navigator.clipboard.writeText(inviteLink.value);
      status.textContent = "Link copiado. Envie-o aos jogadores do time.";
    } catch (error) {
      inviteLink.focus();
      inviteLink.select();
      status.textContent = `${error.message} O link está selecionado para cópia manual.`;
    }
  });

  document.querySelector("#community-revoke-invite").addEventListener("click", async () => {
    if (!activeInviteId) return;
    try {
      getError(await client.rpc("revoke_team_invite", {
        p_invite_id: activeInviteId
      }));
      activeInviteId = null;
      inviteOutput.hidden = true;
      inviteLink.value = "";
      status.textContent = "Convite revogado.";
    } catch (error) {
      showError("Não foi possível revogar o convite", error);
    }
  });

  shareForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedTeam) return;
    status.textContent = "Salvando preferência...";
    const enabled = shareCheckbox.checked;
    let sharingEnabled = false;
    try {
      if (enabled) {
        readLocalGameTotals();
        getError(await client.rpc("set_team_stats_sharing", {
          p_team_id: selectedTeam.id,
          p_enabled: true
        }));
        sharingEnabled = true;
        await syncSharedStats([selectedTeam.id]);
        selectedTeam.shareStats = true;
        status.textContent = "Estatísticas agregadas compartilhadas com este time.";
      } else {
        getError(await client.rpc("set_team_stats_sharing", {
          p_team_id: selectedTeam.id,
          p_enabled: false
        }));
        selectedTeam.shareStats = false;
        status.textContent = "Compartilhamento desativado e estatísticas removidas deste time.";
      }
      await renderMembers();
    } catch (error) {
      if (sharingEnabled) {
        try {
          getError(await client.rpc("set_team_stats_sharing", {
            p_team_id: selectedTeam.id,
            p_enabled: false
          }));
        } catch (rollbackError) {
          console.error("Could not roll back stats sharing:", rollbackError);
          error = new Error(
            `${error.message || "erro inesperado."} Não foi possível desfazer a ativação; desative o compartilhamento manualmente.`
          );
        }
      }
      shareCheckbox.checked = Boolean(selectedTeam.shareStats);
      showError("Não foi possível salvar a preferência de compartilhamento", error);
    }
  });

  window.addEventListener("quadra:games-updated", async () => {
    if (!currentUser) return;
    try {
      await syncAllSharedStats();
      if (selectedTeam) await renderMembers();
    } catch (error) {
      const message = "A partida foi salva, mas não foi possível atualizar as estatísticas compartilhadas.";
      document.querySelector("#game-status").textContent = message;
      showError(message, error);
    }
  });

  client.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => {
      if (session && session.user) {
        showSignedIn(session.user);
      } else if (event === "SIGNED_OUT") {
        currentUser = null;
        teams = [];
        selectedTeam = null;
        dashboard.hidden = true;
        authPanel.hidden = false;
      }
    }, 0);
  });

  authPanel.hidden = false;
  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      if (data.session && data.session.user) showSignedIn(data.session.user);
    })
    .catch((error) => showError("Não foi possível verificar sua sessão", error));
})();
