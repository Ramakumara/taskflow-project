const BASE_URL = window.location.origin;
let socket = null;
let socketReconnectTimer = null;
let socketHeartbeatTimer = null;
const recentRealtimeToastCache = new Map();
const realtimeState = {
    connected: false,
    reconnectAttempts: 0,
    intentionallyClosed: false,
    connectionStatus: "disconnected",
};
const dashboardProjectCache = {
    projects: [],
    tasks: []
};

function getDashboardGlobalSearchTerm() {
    return String(
        document.getElementById("projectSearch")?.value ||
        document.getElementById("adminSearch")?.value ||
        document.getElementById("superSearch")?.value ||
        ""
    ).trim().toLowerCase();
}

function matchesDashboardGlobalSearch(values) {
    const searchTerm = getDashboardGlobalSearchTerm();
    if (!searchTerm) return true;
    return values.some(value => String(value || "").toLowerCase().includes(searchTerm));
}

function getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = sessionStorage.getItem("token") || "";
    return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

function updateRealtimeConnectionStatus(status) {
    realtimeState.connectionStatus = status;
    realtimeState.connected = status === "connected";
    document.documentElement.dataset.realtimeStatus = status;
    document.dispatchEvent(new CustomEvent("taskflow:realtime-status", { detail: { status } }));
}

function clearRealtimeTimers() {
    if (socketReconnectTimer) {
        clearTimeout(socketReconnectTimer);
        socketReconnectTimer = null;
    }
    if (socketHeartbeatTimer) {
        clearInterval(socketHeartbeatTimer);
        socketHeartbeatTimer = null;
    }
}

function scheduleRealtimeReconnect() {
    if (realtimeState.intentionallyClosed || !sessionStorage.getItem("token")) {
        return;
    }
    clearTimeout(socketReconnectTimer);
    const attempt = Math.min(realtimeState.reconnectAttempts + 1, 6);
    realtimeState.reconnectAttempts = attempt;
    const delay = Math.min(1000 * (2 ** (attempt - 1)), 15000);
    socketReconnectTimer = setTimeout(() => {
        connectRealtimeSocket();
    }, delay);
}

function startRealtimeHeartbeat() {
    if (socketHeartbeatTimer) {
        clearInterval(socketHeartbeatTimer);
    }
    socketHeartbeatTimer = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }
        sendRealtimeMessage({
            type: "system.ping",
            data: {
                ts: Date.now()
            }
        });
    }, 25000);
}

function connectRealtimeSocket() {
    const token = sessionStorage.getItem("token");
    if (!token) return null;

    realtimeState.intentionallyClosed = false;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return socket;
    }

    updateRealtimeConnectionStatus("connecting");
    socket = new WebSocket(getWebSocketUrl());

    socket.onopen = function () {
        realtimeState.reconnectAttempts = 0;
        updateRealtimeConnectionStatus("connected");
        startRealtimeHeartbeat();
        console.log("WebSocket connected");
    };

    socket.onclose = function () {
        clearRealtimeTimers();
        updateRealtimeConnectionStatus("disconnected");
        socket = null;
        scheduleRealtimeReconnect();
    };

    socket.onerror = function () {
        updateRealtimeConnectionStatus("error");
    };

    socket.onmessage = function (event) {
        handleRealtimeMessage(event.data);
    };

    return socket;
}

function disconnectRealtimeSocket(options = {}) {
    realtimeState.intentionallyClosed = Boolean(options.intentional ?? true);
    clearRealtimeTimers();

    if (socket) {
        const activeSocket = socket;
        socket = null;
        if (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING) {
            try {
                activeSocket.close(1000, "client disconnect");
            } catch {
                // no-op
            }
        }
    }

    updateRealtimeConnectionStatus("disconnected");
}

function handleRealtimeMessage(raw) {
    let payload = null;

    try {
        payload = JSON.parse(raw);
    } catch {
        if (raw) showNotification(raw);
        return;
    }

    if (!payload || !payload.type) return;

    document.dispatchEvent(new CustomEvent("taskflow:realtime", { detail: payload }));

    if (payload.type === "system.connected" || payload.type === "system.pong") {
        updateRealtimeConnectionStatus("connected");
        return;
    }

    showRealtimeToast(payload);

    refreshRealtimeViews(payload);
}

function getRealtimeToastMeta(payload) {
    const type = String(payload?.type || "").toLowerCase();

    if (type === "notification.created") {
        return {
            title: "New Notification",
            level: "success"
        };
    }

    if (type.startsWith("task.")) {
        return {
            title: "Task Update",
            level: type.includes("deleted") ? "warning" : "success"
        };
    }

    if (type.startsWith("project.")) {
        return {
            title: "Project Update",
            level: type.includes("deleted") ? "warning" : "success"
        };
    }

    if (type.startsWith("file.")) {
        return {
            title: "File Update",
            level: "info"
        };
    }

    if (type.startsWith("user.")) {
        return {
            title: "User Update",
            level: "info"
        };
    }

    return null;
}

function showRealtimeToast(payload) {
    const meta = getRealtimeToastMeta(payload);
    const message = String(payload?.message || "").trim();

    if (!meta || !message) {
        return;
    }

    const cacheKey = `${String(payload?.type || "").toLowerCase()}|${message}`;
    const now = Date.now();
    const lastShownAt = recentRealtimeToastCache.get(cacheKey) || 0;

    if (now - lastShownAt < 4000) {
        return;
    }

    recentRealtimeToastCache.set(cacheKey, now);

    if (recentRealtimeToastCache.size > 50) {
        for (const [key, shownAt] of recentRealtimeToastCache.entries()) {
            if (now - shownAt > 15000) {
                recentRealtimeToastCache.delete(key);
            }
        }
    }

    showNotification(message, meta.level, meta.title);
}

function refreshRealtimeViews(payload) {

    const type = String(payload.type || "");
    const currentRole = sessionStorage.getItem("role");

    // Dashboard notifications
    if (
        type.startsWith("notification.") &&
        typeof loadNotifications === "function"
    ) {
        loadNotifications();
    }

    // Activity log
    if (
        type.startsWith("activity.") &&
        typeof loadActivityLog === "function"
    ) {
        const activityView =
            document.getElementById("activity-view");

        if (
            activityView &&
            !activityView.classList.contains("hidden")
        ) {
            loadActivityLog();
        }
    }

    // Dashboard project cards
    if (
        (
            type.startsWith("task.") ||
            type.startsWith("project.")
        ) &&
        typeof loadProjects === "function"
    ) {

        const dashboardView =
            document.getElementById("dashboard-view");

        if (
            dashboardView &&
            !dashboardView.classList.contains("hidden")
        ) {
            loadProjects();
        }
    }

    // Tasks page
    if (
        type.startsWith("task.") &&
        typeof loadAllTasks === "function"
    ) {

        const tasksView =
            document.getElementById("tasks-view");

        if (
            tasksView &&
            !tasksView.classList.contains("hidden")
        ) {
            loadAllTasks();
        }
    }

    // Workspace
    if (
        (
            type.startsWith("task.") ||
            type.startsWith("project.")
        ) &&
        typeof loadProjectWorkspace === "function"
    ) {

        const workspaceView =
            document.getElementById("project-workspace-view");

        if (
            workspaceView &&
            !workspaceView.classList.contains("hidden")
        ) {
            loadProjectWorkspace();
        }
    }

    // Project page
    if (
        (
            type.startsWith("task.") ||
            type.startsWith("project.") ||
            type.startsWith("file.")
        ) &&
        typeof loadProjectPage === "function"
    ) {

        if (
            window.location.pathname.includes("project-page")
        ) {
            loadProjectPage();
        }
    }

    // Files page
    if (
        type.startsWith("file.") &&
        typeof loadFiles === "function"
    ) {

        const filesView =
            document.getElementById("files-view");

        if (
            filesView &&
            !filesView.classList.contains("hidden")
        ) {
            loadFiles();
        }
    }

    // ADMIN REALTIME REFRESH
    if (
        currentRole === "admin" &&
        (
            type === "admin.dashboard.updated" ||
            type.startsWith("user.") ||
            type.startsWith("task.") ||
            type.startsWith("project.") ||
            type.startsWith("file.") ||
            type.startsWith("activity.") ||
            type.startsWith("notification.")
        )
    ) {

        if (typeof refreshAdminData === "function") {

            Promise.resolve(refreshAdminData())
                .then(() => {

                    if (
                        typeof renderCurrentSection ===
                        "function"
                    ) {
                        renderCurrentSection();
                    }

                    if (
                        typeof loadAdminNotifications ===
                        "function"
                    ) {
                        loadAdminNotifications();
                    }

                    if (
                        typeof updateNotificationCount ===
                        "function"
                    ) {
                        updateNotificationCount();
                    }

                })
                .catch(console.error);
        }
    }
}

function sendRealtimeMessage(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    try {
        socket.send(JSON.stringify(payload));
        return true;
    } catch {
        return false;
    }
}

window.addEventListener("load", connectRealtimeSocket);
window.addEventListener("online", connectRealtimeSocket);
window.addEventListener("beforeunload", () => disconnectRealtimeSocket({ intentional: true }));
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && sessionStorage.getItem("token")) {
        connectRealtimeSocket();
    }
});

function showNotification(message, type = "success", title = "TaskFlow Notification") {

    const normalizedType = ["success", "error", "warning", "info"].includes(type) ? type : "success";

    const notification = document.createElement("div");
    const safeMessage = String(message || "").trim();

    notification.className = `taskflow-notification ${normalizedType}`;
    notification.setAttribute("role", "status");
    notification.setAttribute("aria-live", "polite");
    notification.setAttribute("title", String(title || "TaskFlow"));

    let icon = "fa-circle-check";

    if (normalizedType === "error") {
        icon = "fa-circle-exclamation";
    }

    if (normalizedType === "warning") {
        icon = "fa-triangle-exclamation";
    }

    if (normalizedType === "info") {
        icon = "fa-bell";
    }

    notification.innerHTML = `
        <span class="notification-icon-wrap" aria-hidden="true">
            <i class="fas ${icon}"></i>
        </span>
        <div class="notification-copy">${safeMessage}</div>
    `;

    document
        .getElementById("toast-container")
        .appendChild(notification);

    setTimeout(() => {
        notification.classList.add("show");
    }, 100);

    setTimeout(() => {

        notification.classList.remove("show");

        setTimeout(() => {
            notification.remove();
        }, 300);

    }, 4000);
}

async function handleLogin() {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    const recaptchaToken = grecaptcha.getResponse();

    if (!recaptchaToken) {
        alert("Please complete the reCAPTCHA");
        return;
    }

    try {
        const res = await fetch(`${BASE_URL}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                email, 
                password,
                recaptcha_token: recaptchaToken
            })
        });

        const raw = await res.text();
        let data = {};

        try {
            data = raw ? JSON.parse(raw) : {};
        } catch {
            data = { detail: raw };
        }

        if (res.ok && data.message === "Login success") {
            const normalizedRole = String(data.role || "user").trim().toLowerCase();

            sessionStorage.clear();
            sessionStorage.setItem("token", data.access_token);
            sessionStorage.setItem("username", data.username || "");
            sessionStorage.setItem("email", data.email || email);
            sessionStorage.setItem("role", normalizedRole);
            sessionStorage.setItem("team_id", data.team_id || "");
            sessionStorage.setItem("admin_id", data.admin_id || "");
            sessionStorage.setItem("manager_id", data.manager_id || "");
            connectRealtimeSocket();

            if (normalizedRole === "super_admin") {
                window.location.href = "/super-admin";
            } else if (normalizedRole === "admin") {
                window.location.href = "/admin-page";
            } else {
                window.location.href = "/dashboard-page";
            }
            } else {
                alert(data.message || data.detail || "Login failed");
            }

            grecaptcha.reset(); 

    } catch (err) {
        console.error(err);
        alert(err?.message || "Something went wrong");
    }
}

async function handleRegister() {
    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirm-password").value;

    if (!username || !email || !password || !confirmPassword) {
        alert("Please fill in all fields");
        return;
    }

    if (password !== confirmPassword) {
        alert("Passwords do not match");
        return;
    }

    const res = await fetch(`${BASE_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password })
    });

    const raw = await res.text();
    let data = {};

    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = { detail: raw };
    }

    if (res.ok && data.message === "User registered") {
        alert("Registration successful");
        window.location.href = "/";
    } else {
        alert(data.message || data.detail || "Error registering");
    }
}


function logout() {
    const token = sessionStorage.getItem("token");

    Promise.resolve(token ? fetch(`${BASE_URL}/logout`, {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token
        }
    }) : null).catch(() => null).finally(() => {
        disconnectRealtimeSocket({ intentional: true });
        sessionStorage.clear();
        window.location.href = "/";
    });
}

async function refreshSessionUser() {
    const token = sessionStorage.getItem("token");
    if (!token) return null;

    try {
        const response = await fetch(`${BASE_URL}/me`, {
            headers: {
                "Authorization": "Bearer " + token
            }
        });
        if (!response.ok) return null;
        const user = await response.json();
        const role = String(user.role || "").trim().toLowerCase();
        if (role) sessionStorage.setItem("role", role);
        if (user.username) sessionStorage.setItem("username", user.username);
        if (user.email) sessionStorage.setItem("email", user.email);
        sessionStorage.setItem("team_id", user.team_id || "");
        sessionStorage.setItem("admin_id", user.admin_id || "");
        sessionStorage.setItem("manager_id", user.manager_id || "");
        return user;
    } catch {
        return null;
    }
}

async function createProject() {
    alert("Create projects from the admin workspace so manager, status, and dates are saved correctly.");
    window.location.href = "/admin-page";
}

async function loadProjects() {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");
    const email = sessionStorage.getItem("email");

    const pres = await fetch(`${BASE_URL}/projects`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const projects = await pres.json();

    const tres = await fetch(`${BASE_URL}/tasks`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const tasks = await tres.json();

    dashboardProjectCache.projects = Array.isArray(projects) ? projects : [];
    dashboardProjectCache.tasks = Array.isArray(tasks) ? tasks : [];
    renderDashboardProjectCards(dashboardProjectCache.projects, dashboardProjectCache.tasks);

    if (typeof loadDashboardSummary === "function") {
        loadDashboardSummary();
    }
}

function renderDashboardProjectCards(projects = dashboardProjectCache.projects, tasks = dashboardProjectCache.tasks) {
    const role = sessionStorage.getItem("role");
    const email = sessionStorage.getItem("email");
    const list = document.getElementById("project-grid");
    if (!list) return;

    list.innerHTML = "";
    let visibleCount = 0;

    projects.forEach(p => {

        const projectTasks = tasks.filter(t =>
            String(t.project_id) === String(p.id) &&
            (role === "manager" || role === "admin" ||
            (Array.isArray(t.assigned_to) ? t.assigned_to.some(e => e?.trim().toLowerCase() === email?.trim().toLowerCase()) : t.assigned_to?.trim().toLowerCase() === email?.trim().toLowerCase()))
        );

        if (role === "user" && projectTasks.length === 0) return;

        const managerLabel = getProjectManagerLabel(p);
        const statusLabel = getProjectStatusLabel(p.status);

        if (!matchesDashboardGlobalSearch([
            p.name,
            p.description,
            managerLabel,
            statusLabel,
            formatProjectDateRange(p),
            ...projectTasks.flatMap(task => [
                task.title,
                task.description,
                task.status,
                task.priority,
                task.deadline,
                Array.isArray(task.assigned_to) ? task.assigned_to.join(" ") : task.assigned_to
            ])
        ])) {
            return;
        }

        const card = document.createElement("div");
        card.className = "project-card-ui";

        const statusClass = getProjectStatusClass(p.status);

        card.innerHTML = `
            <div class="card-body project-card-shell">
                <div class="project-card-main">
                    <div class="project-card-icon" aria-hidden="true">
                        <i class="fas fa-folder"></i>
                    </div>
                    <div class="project-card-copy">
                        <h4 class="project-card-title">${escapeHtml(p.name || "Untitled Project")}</h4>
                        <div class="project-card-badges">
                            <span class="project-card-chip subtle">
                                <i class="fas fa-user-tie"></i>
                                ${projectTasks.length} ${projectTasks.length === 1 ? "Task" : "Tasks"}
                            </span>
                            <span class="project-card-chip status ${statusClass}">${escapeHtml(statusLabel)}</span>
                        </div>
                        <div class="project-card-meta">
                            <div class="project-card-meta-row">
                                <i class="far fa-envelope"></i>
                                <span>${escapeHtml(managerLabel)}</span>
                            </div>
                            <div class="project-card-meta-row">
                                <i class="far fa-calendar"></i>
                                <span>${escapeHtml(formatProjectDateRange(p))}</span>
                            </div>
                            <div class="project-card-meta-row status-row ${statusClass}">
                                <i class="fas fa-circle"></i>
                                <span>Status: ${escapeHtml(statusLabel)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="project-card-footer">
                    <span>Created: ${escapeHtml(formatProjectCardCreatedDate(p))}</span>
                    <button class="project-card-cta" type="button" onclick="event.stopPropagation(); openProjectDetails('${escapeHtml(p.id)}')">
                        <span>View Details</span>
                        <i class="fas fa-arrow-right"></i>
                    </button>
                </div>
            </div>
        `;

        card.onclick = () => {
            openProjectDetails(p.id);
        };

        list.appendChild(card);
        visibleCount += 1;
    });

    if (!visibleCount) {
        list.innerHTML = `<div class="empty-state">No results found</div>`;
    }
}

function getProjectManagerLabel(project) {
    return String(project?.assigned_manager || project?.owner_email || "Unassigned manager").trim();
}

function getProjectStatusLabel(status) {
    const normalized = String(status || "Planning").trim().toLowerCase();
    if (normalized === "active") return "Active";
    if (normalized === "completed") return "Completed";
    if (normalized === "on hold") return "On Hold";
    return "Planning";
}

function getProjectStatusClass(status) {
    return getProjectStatusLabel(status).toLowerCase().replace(/\s+/g, "-");
}

function formatProjectDateRange(project) {
    const start = String(project?.start_date || "").trim();
    const end = String(project?.end_date || "").trim();

    if (start && end) return `${formatProjectCardDate(start)} to ${formatProjectCardDate(end)}`;
    if (start) return `Starts ${formatProjectCardDate(start)}`;
    if (end) return `Ends ${formatProjectCardDate(end)}`;
    return "No dates set";
}

function formatProjectCardCreatedDate(project) {
    return formatProjectCardDate(project?.created_at || project?.start_date || project?.end_date) || "Not available";
}

function formatProjectCardDate(value) {
    if (!value) return "";
    const raw = String(value).trim();
    const date = raw.length === 10 ? new Date(`${raw}T00:00:00`) : new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;

    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function openProjectDetails(projectId) {
    sessionStorage.setItem("selectedProjectId", projectId);
    showProjectWorkspace();
    if (typeof loadProjectWorkspace === "function") {
        loadProjectWorkspace();
    }
}

function openCreate(mode = "project") {
    const role = sessionStorage.getItem("role");
    if (mode === "project" && role !== "admin") {
        alert("Projects are created from the admin workspace.");
        return;
    }
    if (mode === "project") {
        alert("Create projects from the admin workspace so manager, status, and dates are saved correctly.");
        window.location.href = "/admin-page";
        return;
    }

    const section = document.getElementById("create-section");
    const projectSection = document.getElementById("project-section");
    const taskSection = document.getElementById("task-section");
    const title = document.getElementById("createPanelTitle");
    const subtitle = document.getElementById("createPanelSubtitle");

    if (!section) {
        console.error("create-section not found ");
        return;
    }

    const createMode = mode === "task" ? "task" : "project";
    section.dataset.createMode = createMode;
    section.classList.remove("hidden");

    if (projectSection) {
        projectSection.classList.toggle("hidden", createMode !== "project");
        projectSection.style.display = createMode === "project" ? "" : "none";
    }
    if (taskSection) {
        taskSection.classList.toggle("hidden", createMode !== "task");
        taskSection.style.display = createMode === "task" ? "" : "none";
    }
    if (title) {
        title.textContent = createMode === "task" ? "Assign Task" : "Create Project";
    }
    if (subtitle) {
        const hasSubtitle = createMode === "task";
        subtitle.textContent = hasSubtitle ? "Create a task and assign it to one or more users." : "";
        subtitle.classList.toggle("hidden", !hasSubtitle);
    }

    if (createMode === "task") {
        loadProjectDropdown();
        loadUsers();
    }
}

function hideCreate() {
    const section = document.getElementById("create-section");
    const projectSection = document.getElementById("project-section");
    const taskSection = document.getElementById("task-section");
    const search = document.getElementById("assigned-user-search");
    if (section) {
        section.classList.add("hidden");
        delete section.dataset.createMode;
    }
    if (projectSection) {
        projectSection.classList.remove("hidden");
        projectSection.style.display = "";
    }
    if (taskSection) {
        taskSection.classList.remove("hidden");
        taskSection.style.display = "";
    }
    if (search) {
        search.value = "";
    }
    filterDashboardTaskAssignees("");
}

async function loadProjectDropdown() {
    const token = sessionStorage.getItem("token");

    const res = await fetch(`${BASE_URL}/projects`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const projects = await res.json();

    const select = document.getElementById("project-select");
    if (!select) return;
    const currentValue = select.value;

    select.innerHTML = "<option value=''>Select Project</option>";

    projects.forEach(p => {
        const option = document.createElement("option");
        option.value = p.id;
        option.text = p.name;
        select.appendChild(option);
    });

    if (currentValue && Array.from(select.options).some(option => String(option.value) === String(currentValue))) {
        select.value = currentValue;
    }
}

async function loadUsers() {
    const token = sessionStorage.getItem("token");

    const res = await fetch(`${BASE_URL}/users`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const users = await res.json();

    const list = document.getElementById("assigned-to-list");
    if (!list) return;

    if (!Array.isArray(users)) {
        list.innerHTML = `<div class="dashboard-task-user-empty">No users available</div>`;
        return;
    }

    const userRoleUsers = users.filter(u => u.role === "user");

    if (userRoleUsers.length === 0) {
        list.innerHTML = `<div class="dashboard-task-user-empty">No registered users</div>`;
        return;
    }

    list.innerHTML = userRoleUsers.map((user) => `
        <label class="dashboard-task-user-option" data-user-search="${escapeHtml(`${String(user.username || "").toLowerCase()} ${String(user.email || "").toLowerCase()}`)}">
            <input type="checkbox" value="${escapeHtml(user.email)}">
            <span>${escapeHtml(user.username || user.email)}</span>
            <small>${escapeHtml(user.email)}</small>
        </label>
    `).join("");
}

async function createTask() {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");
    const submitButton = document.getElementById("dashboardTaskSubmitButton");
    const submitLabel = submitButton?.querySelector("span");
    const submitIcon = submitButton?.querySelector("i");

    if (role !== "manager" && role !== "admin") {
        alert("Only manager or admin can create tasks");
        return;
    }

    const title = document.getElementById("task-title").value.trim();
    const description = document.getElementById("task-description").value.trim();
    const assigned_to = Array.from(document.querySelectorAll("#assigned-to-list input:checked")).map(input => input.value);
    const deadline = document.getElementById("deadline").value;
    const priority = document.getElementById("task-priority").value;
    const project_id = document.getElementById("project-select").value;
    const attachments = Array.from(document.getElementById("task-attachments")?.files || []);

    if (!project_id) {
        alert("Please select a project");
        return;
    }

    if(!title) {
        alert("Task title is required");
        return;
    }

    if (!assigned_to.length) {
        alert("Please assign the task to at least one user");
        return;
    }

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.classList.add("is-loading");
    }
    if (submitLabel) {
        submitLabel.textContent = "Assigning...";
    }
    if (submitIcon) {
        submitIcon.className = "fas fa-plus";
    }

    try {
        const res = await fetch(`${BASE_URL}/tasks`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                title,
                task_title: title,
                project_id,
                description,
                priority,
                assigned_to,
                assigned_users: assigned_to,
                status: "Pending",
                deadline,
                due_date: deadline
            })
        });

        const data = await res.json().catch(() => ({}));
        alert(data?.message || data?.detail || (res.ok ? "Task created" : "Unable to create task"));
        if (!res.ok) return;

        if (attachments.length && data?.task?.id) {
            for (const file of attachments) {
                const formData = new FormData();
                formData.append("file", file);
                await fetch(`${BASE_URL}/tasks/${encodeURIComponent(data.task.id)}/attachments`, {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + token
                    },
                    body: formData
                });
            }
        }
        sendRealtimeMessage({ type: "client.task.created", data: { title } });
        document.getElementById("task-title").value = "";
        document.getElementById("task-description").value = "";
        document.querySelectorAll("#assigned-to-list input:checked").forEach(input => {
            input.checked = false;
        });
        const search = document.getElementById("assigned-user-search");
        if (search) search.value = "";
        filterDashboardTaskAssignees("");
        document.getElementById("deadline").value = "";
        document.getElementById("task-priority").value = "Medium";
        document.getElementById("task-attachments").value = "";
        document.getElementById("project-select").value = "";


        loadProjects();
        if (typeof loadAllTasks === "function") loadAllTasks();
        if (typeof loadProjectWorkspace === "function") loadProjectWorkspace();
        document.getElementById("create-section").classList.add("hidden");
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.classList.remove("is-loading");
        }
        if (submitLabel) {
            submitLabel.textContent = "Assign Task";
        }
        if (submitIcon) {
            submitIcon.className = "fas fa-plus";
        }
    }
}

function filterDashboardTaskAssignees(value) {
    const query = String(value || "").trim().toLowerCase();
    document.querySelectorAll(".dashboard-task-user-option").forEach((option) => {
        const haystack = String(option.dataset.userSearch || "");
        option.style.display = !query || haystack.includes(query) ? "" : "none";
    });
}

async function updateStatus(id, status) {
    const token = sessionStorage.getItem("token");

    try {
        const res = await fetch(`${BASE_URL}/tasks/${id}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({ status })
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            alert("Your status was updated to: " + status);
            sendRealtimeMessage({ type: "client.task.status", data: { task_id: id, status } });
        } else {
            alert(data.message || data.detail || "Failed to update status");
        }

        loadProjects();
        if (typeof loadAllTasks === "function") loadAllTasks();
        if (typeof loadProjectWorkspace === "function") loadProjectWorkspace();

    } catch (err) {
        console.error(err);
        alert("Something went wrong");
    }
}

async function deleteProject(id) {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");

    if (role !== "manager") {
        alert("Not allowed");
        return;
    }

    if (!confirm("Delete this project?")) return;

    const res = await fetch(`${BASE_URL}/projects/${id}`, {
        method: "DELETE",
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    const data = await res.json().catch(() => ({}));
    alert(data.message || data.detail || (res.ok ? "Project deleted" : "Unable to delete project"));
    if (!res.ok) return;
    sendRealtimeMessage({ type: "client.project.deleted", data: { project_id: id } });

    loadProjects();
}

async function deleteTask(id) {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");

    if (role !== "manager" && role !== "admin") {
        alert("Not allowed");
        return;
    }

    if (!confirm("Delete this task?")) return;

    const res = await fetch(`${BASE_URL}/tasks/${id}`, {
        method: "DELETE",
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    const data = await res.json().catch(() => ({}));
    alert(data.message || data.detail || (res.ok ? "Task deleted" : "Unable to delete task"));
    if (!res.ok) return;
    sendRealtimeMessage({ type: "client.task.deleted", data: { task_id: id } });

    if (typeof loadAllTasks === "function") loadAllTasks();
    if (typeof loadProjectWorkspace === "function") loadProjectWorkspace();
}

let activityLogEntries = [];
let activityLogPage = 1;
const activityLogPageSize = 5;

function escapeActivityLogHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function getActivityLogFilterElements() {
    return {
        search: document.getElementById("activityLogSearch"),
        user: document.getElementById("activityLogUserFilter"),
        action: document.getElementById("activityLogActionFilter"),
        startDate: document.getElementById("activityLogStartDate"),
        endDate: document.getElementById("activityLogEndDate"),
        summary: document.getElementById("activity-log-filter-summary"),
        body: document.getElementById("activity-log-body"),
        pagination: document.getElementById("activityLogPagination")
    };
}

function populateActivityLogUserFilter(logs) {
    const { user } = getActivityLogFilterElements();
    if (!user) return;

    const selectedValue = user.value || "all";
    const users = [...new Set(
        (Array.isArray(logs) ? logs : [])
            .map(log => String(log?.user_email || log?.username || "").trim())
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    user.innerHTML = `<option value="all">All Users</option>${users.map(item => `
        <option value="${escapeActivityLogHtml(item)}">${escapeActivityLogHtml(item)}</option>
    `).join("")}`;

    user.value = users.includes(selectedValue) ? selectedValue : "all";
}

function populateActivityLogActionFilter(logs) {
    const { action } = getActivityLogFilterElements();
    if (!action) return;

    const selectedValue = action.value || "all";
    const actions = [...new Set(
        (Array.isArray(logs) ? logs : [])
            .map(log => String(log?.action || "").trim())
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    action.innerHTML = `<option value="all">All Actions</option>${actions.map(item => `
        <option value="${escapeActivityLogHtml(item)}">${escapeActivityLogHtml(item)}</option>
    `).join("")}`;

    action.value = actions.includes(selectedValue) ? selectedValue : "all";
}

function getActivityLogFilteredEntries() {
    const { user, action, startDate, endDate } = getActivityLogFilterElements();
    const searchValue = typeof getDashboardGlobalSearchTerm === "function" ? getDashboardGlobalSearchTerm() : "";
    const userValue = String(user?.value || "all").trim().toLowerCase();
    const actionValue = String(action?.value || "all").trim().toLowerCase();
    const startValue = startDate?.value || "";
    const endValue = endDate?.value || "";
    const start = startValue ? new Date(`${startValue}T00:00:00`) : null;
    const end = endValue ? new Date(`${endValue}T23:59:59.999`) : null;

    return activityLogEntries.filter(log => {
        const actionText = String(log?.action || "").trim();
        const userText = String(log?.user_email || log?.username || "").trim();
        const timestamp = log?.timestamp ? new Date(log.timestamp) : null;
        const haystack = [
            userText,
            actionText,
            log?.target,
            log?.details
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        if (searchValue && !haystack.includes(searchValue)) return false;
        if (userValue !== "all" && userText.toLowerCase() !== userValue) return false;
        if (actionValue !== "all" && actionText.toLowerCase() !== actionValue) return false;
        if ((start || end) && (!timestamp || Number.isNaN(timestamp.getTime()))) return false;
        if (start && timestamp < start) return false;
        if (end && timestamp > end) return false;
        return true;
    });
}

function formatActivityLogDetails(log) {
    const target = String(log?.target || "").trim();
    const details = String(log?.details || "").trim();

    if (target && details) {
        return `${target} | ${details}`;
    }

    return target || details || "-";
}

function renderActivityLogRows(logs) {
    const { body, summary, pagination } = getActivityLogFilterElements();
    if (!body) return;

    if (!activityLogEntries.length) {
        body.innerHTML = `<tr><td colspan="4">No activity records found.</td></tr>`;
        if (summary) summary.textContent = "No activity records available.";
        if (pagination) pagination.innerHTML = "";
        return;
    }

    const filteredLogs = Array.isArray(logs) ? logs : getActivityLogFilteredEntries();
    const totalPages = Math.max(Math.ceil(filteredLogs.length / activityLogPageSize), 1);
    activityLogPage = Math.min(Math.max(activityLogPage, 1), totalPages);
    const startIndex = (activityLogPage - 1) * activityLogPageSize;
    const pageLogs = filteredLogs.slice(startIndex, startIndex + activityLogPageSize);

    if (!filteredLogs.length) {
        body.innerHTML = `<tr><td colspan="4">No results found</td></tr>`;
        if (pagination) pagination.innerHTML = "";
    } else {
        body.innerHTML = pageLogs.map(log => {
            const details = formatActivityLogDetails(log);

            return `
                <tr>
                    <td>${escapeActivityLogHtml(formatDateTime(log?.timestamp))}</td>
                    <td>${escapeActivityLogHtml(log?.user_email || log?.username || "-")}</td>
                    <td>${escapeActivityLogHtml(log?.action || "-")}</td>
                    <td>${escapeActivityLogHtml(details)}</td>
                </tr>
            `;
        }).join("");

        if (pagination) {
            pagination.innerHTML = `
                <span class="app-pagination-summary">${filteredLogs.length ? `Showing ${startIndex + 1} to ${startIndex + pageLogs.length} of ${filteredLogs.length} activity records` : "Showing 0 activity records"}</span>
                <div class="task-pagination-controls app-pagination-controls">
                    <button class="task-page-btn app-page-btn" type="button" onclick="setActivityLogPage(${activityLogPage - 1})" ${activityLogPage <= 1 ? "disabled" : ""} aria-label="Previous activity log page">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <span class="task-page-current app-page-current">${activityLogPage}</span>
                    <button class="task-page-btn app-page-btn" type="button" onclick="setActivityLogPage(${activityLogPage + 1})" ${activityLogPage >= totalPages ? "disabled" : ""} aria-label="Next activity log page">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            `;
        }
    }

    if (summary) {
        summary.textContent = `${filteredLogs.length} of ${activityLogEntries.length} activity record${activityLogEntries.length === 1 ? "" : "s"} shown`;
    }
}

function handleActivityLogFiltersChange() {
    const { startDate, endDate } = getActivityLogFilterElements();
    if (startDate && endDate && startDate.value && endDate.value && startDate.value > endDate.value) {
        endDate.value = startDate.value;
    }

    updateActivityLogDateLabel();
    activityLogPage = 1;
    renderActivityLogRows();
}

function resetActivityLogFilters() {
    const { user, action, startDate, endDate } = getActivityLogFilterElements();
    if (user) user.value = "all";
    if (action) action.value = "all";
    if (startDate) startDate.value = "";
    if (endDate) endDate.value = "";
    updateActivityLogDateLabel();
    activityLogPage = 1;
    renderActivityLogRows(activityLogEntries);
}

function setActivityLogPage(page) {
    activityLogPage = page;
    renderActivityLogRows();
}

function formatActivityLogRangeDate(value) {
    if (!value) return "";

    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function updateActivityLogDateLabel() {
    const label = document.getElementById("activity-log-date-label");
    const startInput = document.getElementById("activityLogStartDate");
    const endInput = document.getElementById("activityLogEndDate");
    if (!label) return;

    const startDate = startInput?.value || "";
    const endDate = endInput?.value || "";

    if (startDate && endDate) {
        label.textContent = `${formatActivityLogRangeDate(startDate)} to ${formatActivityLogRangeDate(endDate)}`;
        return;
    }

    if (startDate) {
        label.textContent = `From ${formatActivityLogRangeDate(startDate)}`;
        return;
    }

    if (endDate) {
        label.textContent = `Until ${formatActivityLogRangeDate(endDate)}`;
        return;
    }

    label.textContent = "All dates";
}

function toggleActivityLogDatePicker(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("activity-log-date-popover");
    if (popover) popover.classList.toggle("hidden");
}

function onActivityLogDateChange() {
    updateActivityLogDateLabel();
    handleActivityLogFiltersChange();
}

function clearActivityLogDateRange() {
    const startInput = document.getElementById("activityLogStartDate");
    const endInput = document.getElementById("activityLogEndDate");
    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
    updateActivityLogDateLabel();
    handleActivityLogFiltersChange();
}

async function loadActivityLog() {
    const token = sessionStorage.getItem("token");
    const { body, summary, pagination } = getActivityLogFilterElements();
    if (!body) return;

    body.innerHTML = `<tr><td colspan="4">Loading activity log...</td></tr>`;
    if (summary) summary.textContent = "Loading activity records...";
    if (pagination) pagination.innerHTML = "";

    try {
        const res = await fetch(`${BASE_URL}/activities`, {
            headers: { "Authorization": "Bearer " + token }
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            body.innerHTML = `<tr><td colspan="4">${error.message || error.detail || "Unable to load activity log."}</td></tr>`;
            if (summary) summary.textContent = "Unable to load activity records.";
            if (pagination) pagination.innerHTML = "";
            return;
        }

        const logs = await res.json();
        if (!Array.isArray(logs) || logs.length === 0) {
            activityLogEntries = [];
            activityLogPage = 1;
            populateActivityLogUserFilter([]);
            populateActivityLogActionFilter([]);
            body.innerHTML = `<tr><td colspan="4">No activity records found.</td></tr>`;
            if (summary) summary.textContent = "No activity records available.";
            return;
        }

        activityLogEntries = logs
            .slice()
            .sort((a, b) => new Date(b?.timestamp || 0) - new Date(a?.timestamp || 0));
        activityLogPage = 1;
        populateActivityLogUserFilter(activityLogEntries);
        populateActivityLogActionFilter(activityLogEntries);
        renderActivityLogRows(activityLogEntries);
        return;

        body.innerHTML = "";
        logs.slice(0, 30).forEach(log => {
            const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleString() : "-";
            const userText = log.user_email || "-";
            const details = [log.target, log.details].filter(Boolean).join(" — ") || "-";

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${formatDateTime(log.timestamp)}</td>                
                <td>${userText}</td>
                <td>${log.action}</td>
                <td>${details}</td>
            `;
            body.appendChild(row);
        });
    } catch (err) {
        console.error(err);
        activityLogEntries = [];
        populateActivityLogActionFilter([]);
        body.innerHTML = `<tr><td colspan="4">Unable to load activity log.</td></tr>`;
        if (summary) summary.textContent = "Unable to load activity records.";
    }
}

window.setActivityLogPage = setActivityLogPage;

document.addEventListener("click", event => {
    const popover = document.getElementById("activity-log-date-popover");
    const dateControl = document.querySelector(".activity-log-date-control");
    if (popover && dateControl && !popover.classList.contains("hidden") && !dateControl.contains(event.target)) {
        popover.classList.add("hidden");
    }
});

async function exportActivityLog() {
    const token = sessionStorage.getItem("token");

    try {
        const res = await fetch(`${BASE_URL}/activities/export`, {
            headers: { "Authorization": "Bearer " + token }
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            alert(error.message || error.detail || "Failed to export activity log.");
            return;
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "taskflow-activity-log.csv";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        console.error(err);
        alert("Failed to export activity log.");
    }
}

window.onload = async function () {
    let role = String(sessionStorage.getItem("role") || "").trim().toLowerCase();
    const username = sessionStorage.getItem("username");
    const isDashboard = window.location.pathname.includes("dashboard-page");

    if (!role && isDashboard) {
        alert("Please login first");
        window.location.href = "/";
        return;
    }

    if (isDashboard && sessionStorage.getItem("token")) {
        const freshUser = await refreshSessionUser();
        role = String(freshUser?.role || role || "").trim().toLowerCase();
    }

    if (isDashboard && role === "admin") {
        window.location.replace("/admin-page");
        return;
    }

    if (isDashboard && role === "super_admin") {
        window.location.replace("/super-admin");
        return;
    }

    const welcome = document.getElementById("welcome-user");
    if (welcome && username) {
        welcome.innerText = username;
    }

    if (role !== "manager") {
        const projectSection = document.getElementById("project-section");
        const taskSection = document.getElementById("task-section");
        const openCreateButtons = document.querySelectorAll(".create-btn, .sidebar-create-btn");

        if (projectSection) projectSection.style.display = "none";
        if (taskSection) taskSection.style.display = "none";
        openCreateButtons.forEach(button => {
            button.style.display = "none";
        });
    }

    if (isDashboard) {
        loadProjects();
        loadProjectDropdown();
        loadUsers();
        setAvatar();
        checkAssignedTaskNotifications();
        checkTaskReminders();
    }
};

function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);

    return date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata", 
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

function formatDeadlineDate(value) {
    if (!value) return "N/A";

    const date = String(value).length === 10
        ? new Date(`${value}T00:00:00`)
        : new Date(value);

    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    }).replace(/ /g, "-");
}

function setAvatar() {
    const username = sessionStorage.getItem("username") || "";
    const email = sessionStorage.getItem("email") || "";
    const nameSource = username.trim() || email.trim();

    if (nameSource) {
        const firstLetter = nameSource.charAt(0).toUpperCase();
        const colors = ["#0c974a", "#0c974a", "#0c974a", "#0c974a"];

        const color = colors[Math.floor(Math.random() * colors.length)];

        const avatar = document.getElementById("avatar");
        if (avatar) {
            avatar.innerText = firstLetter;
            avatar.style.background = color;
        }
    }
}

function toggleMenu() {
    const menu = document.getElementById("dropdown-menu");
    if (!menu) return;
    menu.classList.toggle("hidden");
}

document.addEventListener("click", function (e) {

    const menu = document.getElementById("dropdown-menu");
    const trigger = document.getElementById("profile-trigger");

    if (
        menu &&
        !e.target.closest("#profile-trigger") &&
        !e.target.closest("#dropdown-menu")
    ) {
        menu.classList.add("hidden");
    }

});

function goToSettings() {
    alert("Settings page coming soon!");    
}

function goToIndex() {
    alert("Index page coming soon!")
}

function goToProfile() {
    const profileView = document.getElementById("profile-view");
    if (profileView && typeof showView === "function" && typeof loadDashboardProfile === "function") {
        if (typeof setActiveMenu === "function") setActiveMenu("");
        showView("profile-view");
        loadDashboardProfile();
        return;
    }
    window.location.href = "/dashboard-page";
}


async function loadStatusPage() {
    const token = sessionStorage.getItem("token");

   const pres = await fetch(`${BASE_URL}/projects`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const projects = await pres.json();

    const tres = await fetch(`${BASE_URL}/tasks`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const tasks = await tres.json();

    console.log("Projects:", projects);
    console.log("Tasks:", tasks);

    renderSummary(projects, tasks);
    renderProjectWiseCharts(projects, tasks);
}

function statusOverview() {
    
    window.location.href = "/status-overview-page";

}

function dashboard() {
    window.location.href = "/dashboard-page";
}

function setProjectTab(tab) {
    if (tab === "dashboard") {
        window.location.href = "/dashboard-page";
        return;
    }

    if (tab === "activity") {
        window.location.href = "/status-overview-page";
        return;
    }

    if (tab === "overview" || tab === "tasks" || tab === "team" || tab === "files") {
        window.location.href = "/project-page";
        return;
    }

    window.location.href = "/dashboard-page";
}





function loadProjectPage() {
    const projectId = sessionStorage.getItem("selectedProjectId");
    const role = sessionStorage.getItem("role"); 
    const token = sessionStorage.getItem("token"); 

    if (role !== "manager") {
        const actionHeader = document.getElementById("action-header");
        if (actionHeader) actionHeader.style.display = "none";
    }
    
    
    fetch(`${BASE_URL}/projects`, {
        headers: {
            "Authorization": "Bearer " + token
        }
    })
        .then(res => res.json())
        .then(projects => {
            const project = projects.find(p => String(p.id) === String(projectId));
            document.getElementById("project-title").innerText = project?.name || "Project";
        });


    fetch(`${BASE_URL}/tasks`, {
        headers: {
            "Authorization": "Bearer " + token
        }
    })
        .then(res => res.json())
        .then(tasks => {
            const list = document.getElementById("task-list");
            list.innerHTML = "";

            const projectTasks = tasks.filter(t =>
                String(t.project_id) === String(projectId)
            );

            if (projectTasks.length === 0) {
                list.innerHTML = `
                    <tr>
                        <td colspan="4">No tasks available</td>
                    </tr>
                `;
                return;
            }

            projectTasks.forEach(t => {
                const row = document.createElement("tr");
                const assignedDisplay = role === "user" ? getTaskAssignedBy(t, null) : renderTaskMemberBadges(t);
                const statusClass = taskStatusClass(t.status);

                row.innerHTML = `
                    <td>${t.title}</td>
                    <td>${assignedDisplay || "Unknown"}</td>
                    <td>${formatDeadlineDate(t.deadline)}</td>

                    ${
                        role === "user"
                        ? `
                        <td>
                            ${renderMyTaskStatusControl(t)}
                        </td>
                        `
                        : `
                        <td>
                            <span class="status-pill ${statusClass}">${normalizeTaskStatus(t.status)}</span>
                        </td>
                        `
                    }

                    ${
                        role === "manager"
                        ? `
                        <td>
                            <button onclick="deleteTask('${t.id}')">Delete</button>
                        </td>
                        `
                        : ""
                    }
                `;

                list.appendChild(row);
            });
        });
}


function handleProjectSearch(event) {
    if (event?.target) {
        event.target.value = event.target.value || "";
    }

    if (typeof renderDashboardProjectCards === "function") {
        renderDashboardProjectCards();
    }
    if (typeof renderDashboardTaskBoard === "function") {
        dashboardTaskPage = 1;
        renderDashboardTaskBoard();
    }
    if (typeof renderTeamWorkspace === "function") {
        renderTeamWorkspace();
    }
    if (typeof handleActivityLogFiltersChange === "function") {
        handleActivityLogFiltersChange();
    }
    if (typeof renderFiles === "function") {
        filesPage = 1;
        renderFiles();
    }
    if (typeof loadProjectWorkspace === "function") {
        const workspaceView = document.getElementById("project-workspace-view");
        if (workspaceView && !workspaceView.classList.contains("hidden")) {
            projectWorkspaceTaskPage = 1;
            loadProjectWorkspace();
        }
    }
}

function handleTaskSearch(event) {
    const searchValue = event.target.value.toLowerCase();
    const taskRows = document.querySelectorAll("#task-list tr");
    
    taskRows.forEach(row => {
        const taskText = row.textContent.toLowerCase();
        if (taskText.includes(searchValue)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}


async function checkAssignedTaskNotifications() {

    const token = sessionStorage.getItem("token");
    const email = sessionStorage.getItem("email");

    if (!token || !email) return;

    try {

        const res = await fetch(`${BASE_URL}/tasks`, {
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        const tasks = await res.json();

        if (!Array.isArray(tasks)) return;

        const assignedTasks = tasks.filter(task =>
            Array.isArray(task.assigned_to) ? task.assigned_to.includes(email) : task.assigned_to === email
        );

        assignedTasks.forEach(task => {

            const notificationKey = `task_notification_${task.id}`;

            // Prevent duplicate popup
            if (!sessionStorage.getItem(notificationKey)) {

                showNotification(
                    `New Task Assigned: ${task.title}`,
                    "success"
                );

                sessionStorage.setItem(notificationKey, "shown");
            }

        });

    } catch (error) {

        console.error("Notification check failed", error);

    }
}

async function checkTaskReminders() {

    const token = sessionStorage.getItem("token");

    if (!token) return;

    try {

        const response = await fetch(`${BASE_URL}/tasks`, {
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        const tasks = await response.json();

        const today = new Date();

        tasks.forEach(task => {

            if (!task.deadline) return;

            // Skip completed tasks
            if (
                normalizeTaskStatus(task.status) === "Completed"
            ) return;

            const deadline = new Date(task.deadline);

            const diffTime = deadline - today;

            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));



            // Tomorrow reminder
            if (diffDays === 1) {

                showNotification(
                    `Reminder: "${task.title}" deadline is tomorrow`,
                    "warning"
                );
            }



            // Due today
            if (diffDays === 0) {

                showNotification(
                    `Task "${task.title}" is due today`,
                    "warning"
                );
            }



            // Overdue
            if (diffDays < 0) {

                showNotification(
                    `Task "${task.title}" is overdue`,
                    "error"
                );
            }

        });

    } catch (error) {

        console.error(error);
    }
}

function getTaskAssignments(task) {
    if (Array.isArray(task?.assignments)) return task.assignments;
    if (Array.isArray(task?.assigned_statuses)) return task.assigned_statuses;

    const assigned = Array.isArray(task?.assigned_to)
        ? task.assigned_to
        : (task?.assigned_to ? [task.assigned_to] : []);

    return assigned.map(email => ({
        user_id: email,
        status: normalizeTaskStatus(task?.status)
    }));
}

function normalizeTaskStatus(status) {
    const value = String(status || "Pending").trim().toLowerCase();
    if (value === "todo" || value === "pending") return "Pending";
    if (value === "in progress" || value === "progress") return "In Progress";
    if (value === "done" || value === "completed") return "Completed";
    return "Pending";
}

function taskStatusClass(status) {
    return normalizeTaskStatus(status).toLowerCase().replace(/\s+/g, "-");
}

function getMyTaskAssignment(task) {
    const email = (sessionStorage.getItem("email") || "").trim().toLowerCase();
    return getTaskAssignments(task).find(assignment =>
        String(assignment.user_id || "").trim().toLowerCase() === email
    );
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function renderTaskMemberBadges(task) {
    const assignments = getTaskAssignments(task);
    if (!assignments.length) return `<span class="member-status-empty">Unassigned</span>`;

    return `
        <div class="assignee-list">
            ${assignments.map(assignment => {
                const email = String(assignment.user_id || "Unassigned");
                return `
                    <span class="assignee-pill" title="${escapeHtml(email)}">
                        <i class="fas fa-user"></i>
                        <span>${escapeHtml(email)}</span>
                    </span>
                `;
            }).join("")}
        </div>
    `;
}

function renderMyTaskStatusControl(task) {
    const assignment = getMyTaskAssignment(task);
    const status = normalizeTaskStatus(assignment?.status);

    if (!assignment) return `<span class="member-status-empty">Not assigned</span>`;

    return `
        <select class="member-status-select" onchange="updateStatus('${task.id}', this.value)">
            <option value="Pending" ${status === "Pending" ? "selected" : ""}>Pending</option>
            <option value="In Progress" ${status === "In Progress" ? "selected" : ""}>In Progress</option>
            <option value="Completed" ${status === "Completed" ? "selected" : ""}>Completed</option>
        </select>
    `;
}
