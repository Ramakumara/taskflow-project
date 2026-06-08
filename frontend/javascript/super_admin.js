const superState = {
    view: "dashboard",
    search: "",
    dashboard: null,
    analytics: null,
    users: [],
    admins: [],
    projects: [],
    tasks: [],
    taskAnalytics: null,
    auditLogs: [],
    settings: null,
    charts: {},
    pageSize: 8,
    pagination: {
        users: 1,
        admins: 1,
        projects: 1,
        tasks: 1,
        audit: 1
    },
    filters: {
        role: "all",
        status: "all",
        projectStatus: "all",
        taskStatus: "all",
        taskProject: "all",
        taskManager: "all",
        auditAction: "all"
    }
};

function superToken() {
    return sessionStorage.getItem("token") || "";
}

function superHeaders(json = false) {
    const headers = { Authorization: "Bearer " + superToken() };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
}

async function superFetch(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
            ...superHeaders(Boolean(options.body)),
            ...(options.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.detail || data.message || "Request failed");
    }
    return data;
}

function initializeSuperAdmin() {
    const username = sessionStorage.getItem("username") || "Super Admin";
    const welcome = document.getElementById("superWelcome");
    if (welcome) welcome.textContent = username;
    loadSuperView("dashboard");
}

function setSuperView(view) {
    superState.view = view;
    superState.search = "";
    resetSuperPage(view);
    const search = document.getElementById("superSearch");
    if (search) search.value = "";
    document.querySelectorAll(".super-nav-item").forEach(item => {
        item.classList.toggle("active", item.dataset.view === view);
    });
    loadSuperView(view);
}

function handleSuperSearch(value) {
    superState.search = String(value || "").trim().toLowerCase();
    resetSuperPage(superState.view);
    renderSuperView();
}

async function loadSuperView(view = superState.view) {
    showSuperLoading();
    try {
        if (view === "dashboard") {
            superState.dashboard = await superFetch("/super-admin/dashboard");
        } else if (view === "users") {
            superState.users = await superFetch("/super-admin/users");
        } else if (view === "admins") {
            superState.admins = await superFetch("/admin-management/admins");
        } else if (view === "projects") {
            superState.projects = await superFetch("/super-admin/projects");
            await ensureSuperUsers();
        } else if (view === "tasks") {
            await ensureSuperProjects();
            await ensureSuperUsers();
            const data = await superFetch("/super-admin/tasks");
            superState.tasks = data.tasks || [];
            superState.taskAnalytics = data.analytics || {};
        } else if (view === "analytics") {
            superState.analytics = await superFetch("/super-admin/analytics");
        } else if (view === "audit") {
            superState.auditLogs = await superFetch("/audit-logs");
        } else if (view === "settings") {
            superState.settings = await superFetch("/system-settings");
        }
        renderSuperView();
    } catch (error) {
        showSuperError(error.message);
    }
}

async function ensureSuperUsers() {
    if (!superState.users.length) {
        superState.users = await superFetch("/super-admin/users");
    }
}

async function ensureSuperProjects() {
    if (!superState.projects.length) {
        superState.projects = await superFetch("/super-admin/projects");
    }
}

function renderSuperView() {
    clearSuperCharts();
    if (superState.view === "dashboard") renderDashboard();
    if (superState.view === "users") renderUsers();
    if (superState.view === "admins") renderAdmins();
    if (superState.view === "projects") renderProjects();
    if (superState.view === "tasks") renderTasks();
    if (superState.view === "analytics") renderAnalytics();
    if (superState.view === "audit") renderAuditLogs();
    if (superState.view === "settings") renderSettings();
}

function showSuperLoading() {
    document.getElementById("superContent").innerHTML = `<div class="super-loading">Loading ${escapeSuper(superState.view)}...</div>`;
}

function showSuperError(message) {
    document.getElementById("superContent").innerHTML = `<div class="super-empty">${escapeSuper(message)}</div>`;
    notifySuper(message, "error");
}

function pageHead(title, subtitle, action = "") {
    return `
        <header class="page-head">
            <div class="page-title">
                <h1>${escapeSuper(title)}</h1>
                <p>${escapeSuper(subtitle)}</p>
            </div>
            ${action ? `<div class="action-row">${action}</div>` : ""}
        </header>
    `;
}

function statCard(label, value, icon) {
    return `
        <article class="super-stat-card">
            <span class="super-stat-icon"><i class="fas ${icon}"></i></span>
            <div><small>${escapeSuper(label)}</small><strong>${escapeSuper(formatMetric(value))}</strong></div>
        </article>
    `;
}

function renderDashboard() {
    const data = superState.dashboard || {};
    setHealth(data.system_health);
    document.getElementById("superContent").innerHTML = `
        ${pageHead("Enterprise Command Center", "Platform-wide users, projects, work health, automation, and system signals.")}
        <section class="stat-grid">
            ${statCard("Total Users", data.total_users, "fa-users")}
            ${statCard("Total Admins", data.total_admins, "fa-user-shield")}
            ${statCard("Total Managers", data.total_managers, "fa-user-tie")}
            ${statCard("Active Projects", data.total_active_projects, "fa-folder-open")}
            ${statCard("Total Tasks", data.total_tasks, "fa-list-check")}
            ${statCard("Completed Tasks", data.completed_tasks, "fa-circle-check")}
            ${statCard("Pending Tasks", data.pending_tasks, "fa-hourglass-half")}
            ${statCard("Overdue Tasks", data.overdue_tasks, "fa-triangle-exclamation")}
            ${statCard("Notifications Sent", data.total_notifications_sent, "fa-bell")}
            ${statCard("AI Queries", data.total_ai_queries, "fa-robot")}
            ${statCard("Storage Used", formatBytes(data.total_storage_used), "fa-database")}
            ${statCard("Super Admins", data.total_super_admins, "fa-crown")}
        </section>
        <section class="panel-grid">
            ${chartPanel("User Growth", "superUserGrowth")}
            ${chartPanel("Project Growth", "superProjectGrowth")}
            ${chartPanel("Task Status Distribution", "superTaskStatus")}
            ${listPanel("System Health Overview", renderHealthList(data.system_health))}
            ${listPanel("Recent Activities", renderActivityList(data.recent_activities))}
            ${listPanel("Top Active Projects", renderTopProjects(data.top_active_projects))}
        </section>
    `;
    drawLineChart("superUserGrowth", data.user_growth || [], "Users");
    drawLineChart("superProjectGrowth", data.project_growth || [], "Projects");
    drawPieChart("superTaskStatus", data.task_status_distribution || {});
}

function chartPanel(title, canvasId) {
    return `
        <section class="super-panel">
            <div class="panel-head"><div><h3>${escapeSuper(title)}</h3><p>Updated from platform data</p></div></div>
            <div class="chart-box"><canvas id="${canvasId}"></canvas></div>
        </section>
    `;
}

function listPanel(title, content) {
    return `
        <section class="super-panel">
            <div class="panel-head"><div><h3>${escapeSuper(title)}</h3><p>Latest platform signals</p></div></div>
            ${content}
        </section>
    `;
}

function renderUsers() {
    const users = filteredUsers();
    const page = paginateSuperItems("users", users);
    document.getElementById("superContent").innerHTML = `
        ${pageHead("User Management", "Search, filter, promote, demote, suspend, reset, and delete platform users.")}
        <div class="toolbar">
            <input type="search" placeholder="Search users..." value="${escapeSuper(superState.search)}" oninput="handleSuperSearch(this.value)">
            <select onchange="setSuperFilter('role', this.value)">
                ${option("all", "All roles", superState.filters.role)}
                ${option("user", "Users", superState.filters.role)}
                ${option("manager", "Managers", superState.filters.role)}
                ${option("admin", "Admins", superState.filters.role)}
                ${option("super_admin", "Super Admins", superState.filters.role)}
            </select>
            <select onchange="setSuperFilter('status', this.value)">
                ${option("all", "All status", superState.filters.status)}
                ${option("active", "Active", superState.filters.status)}
                ${option("suspended", "Suspended", superState.filters.status)}
            </select>
        </div>
        <section class="super-panel table-wrap">
            ${usersTable(page.items)}
            ${paginationFooter("users", users.length, "users")}
        </section>
    `;
}

function usersTable(users) {
    return `
        <table class="super-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
                ${users.length ? users.map(user => `
                    <tr>
                        <td>${userCell(user)}</td>
                        <td>${escapeSuper(user.email || "-")}</td>
                        <td><span class="badge ${roleClass(user.role)}">${labelRole(user.role)}</span></td>
                        <td><span class="badge ${escapeSuper(user.status || "active")}">${capitalize(user.status || "active")}</span></td>
                        <td>${formatDate(user.last_login)}</td>
                        <td>${formatDate(user.created_at)}</td>
                        <td>${userActions(user)}</td>
                    </tr>
                `).join("") : emptyRow(7, "No users found.")}
            </tbody>
        </table>
    `;
}

function userActions(user) {
    const email = escapeSuper(user.email || "");
    const role = String(user.role || "user");
    const status = String(user.status || "active");
    if (role === "super_admin") return `<span class="badge">Protected</span>`;
    return `
        <div class="action-row">
            ${role === "user" ? smallButton("Promote", `updateSuperUser('${email}', { role: 'manager' })`, "fa-arrow-up") : ""}
            ${role === "manager" ? smallButton("Promote", `updateSuperUser('${email}', { role: 'admin' })`, "fa-arrow-up") : ""}
            ${role === "admin" ? smallButton("Demote", `updateSuperUser('${email}', { role: 'manager' })`, "fa-arrow-down") : ""}
            ${status === "suspended" ? smallButton("Activate", `updateSuperUser('${email}', { status: 'active' })`, "fa-toggle-on") : smallButton("Suspend", `updateSuperUser('${email}', { status: 'suspended' })`, "fa-ban", "warning")}
            ${smallButton("Reset", `resetSuperPassword('${email}')`, "fa-key")}
            ${smallButton("Delete", `deleteSuperUser('${email}')`, "fa-trash", "danger")}
        </div>
    `;
}

function renderAdmins() {
    const admins = filterBySearch(superState.admins, ["username", "email", "status"]);
    const page = paginateSuperItems("admins", admins);
    document.getElementById("superContent").innerHTML = `
        ${pageHead("Admin Management", "Create admins, deactivate accounts, and review admin activity and performance.", `<button class="super-btn primary" onclick="openAdminModal()"><i class="fas fa-plus"></i>Create Admin</button>`)}
        <section class="super-panel table-wrap">
            <table class="super-table">
                <thead><tr><th>Admin</th><th>Status</th><th>Projects Managed</th><th>Users Managed</th><th>Tasks Created</th><th>Last Login</th><th>Actions</th></tr></thead>
                <tbody>
                    ${page.items.length ? page.items.map(admin => `
                        <tr>
                            <td>${userCell(admin)}<div>${escapeSuper(admin.email || "")}</div></td>
                            <td><span class="badge ${escapeSuper(admin.status || "active")}">${capitalize(admin.status || "active")}</span></td>
                            <td>${formatNumber(admin.projects_managed)}</td>
                            <td>${formatNumber(admin.users_managed)}</td>
                            <td>${formatNumber(admin.tasks_created)}</td>
                            <td>${formatDate(admin.last_login)}</td>
                            <td>
                                <div class="action-row">
                                    ${smallButton("Activity", `viewAdminActivity('${escapeSuper(admin.email)}')`, "fa-clock-rotate-left")}
                                    ${smallButton("Demote", `updateAdmin('${escapeSuper(admin.email)}', { role: 'manager' })`, "fa-arrow-down", "warning")}
                                    ${smallButton(admin.status === "suspended" ? "Activate" : "Deactivate", `updateAdmin('${escapeSuper(admin.email)}', { status: '${admin.status === "suspended" ? "active" : "suspended"}' })`, "fa-ban")}
                                </div>
                            </td>
                        </tr>
                    `).join("") : emptyRow(7, "No admins found.")}
                </tbody>
            </table>
            ${paginationFooter("admins", admins.length, "admins")}
        </section>
    `;
}

function renderProjects() {
    const projects = filteredProjects();
    const page = paginateSuperItems("projects", projects);
    const managers = superState.users.filter(user => user.role === "manager");
    document.getElementById("superContent").innerHTML = `
        ${pageHead("Global Project Management", "View every project, archive, transfer ownership, reassign managers, and delete when needed.")}
        <div class="toolbar">
            <input type="search" placeholder="Search projects..." value="${escapeSuper(superState.search)}" oninput="handleSuperSearch(this.value)">
            <select onchange="setSuperFilter('projectStatus', this.value)">
                ${option("all", "All status", superState.filters.projectStatus)}
                ${option("Planning", "Planning", superState.filters.projectStatus)}
                ${option("Active", "Active", superState.filters.projectStatus)}
                ${option("Completed", "Completed", superState.filters.projectStatus)}
                ${option("On Hold", "On Hold", superState.filters.projectStatus)}
            </select>
        </div>
        <section class="super-panel table-wrap">
            <table class="super-table">
                <thead><tr><th>Project Name</th><th>Manager</th><th>Team Size</th><th>Progress</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody>
                    ${page.items.length ? page.items.map(project => `
                        <tr>
                            <td><strong>${escapeSuper(project.name || project.project_name || "Untitled")}</strong></td>
                            <td>${escapeSuper(project.assigned_manager || "Unassigned")}</td>
                            <td>${formatNumber(project.team_size || 0)}</td>
                            <td>${progress(project.progress || 0)}</td>
                            <td><span class="badge ${statusClass(project.status)}">${escapeSuper(project.status || "Planning")}</span></td>
                            <td>${formatDate(project.created_at)}</td>
                            <td>
                                <div class="action-row">
                                    <select onchange="transferProject('${escapeSuper(project.id)}', this.value)">
                                        <option value="">Transfer</option>
                                        ${managers.map(manager => `<option value="${escapeSuper(manager.email)}">${escapeSuper(manager.username || manager.email)}</option>`).join("")}
                                    </select>
                                    ${smallButton("Archive", `archiveProject('${escapeSuper(project.id)}')`, "fa-box-archive", "warning")}
                                    ${smallButton("Delete", `deleteProjectGlobal('${escapeSuper(project.id)}')`, "fa-trash", "danger")}
                                </div>
                            </td>
                        </tr>
                    `).join("") : emptyRow(7, "No projects found.")}
                </tbody>
            </table>
            ${paginationFooter("projects", projects.length, "projects")}
        </section>
    `;
}

function renderTasks() {
    const tasks = filteredTasks();
    const page = paginateSuperItems("tasks", tasks);
    const managers = superState.users.filter(user => user.role === "manager");
    document.getElementById("superContent").innerHTML = `
        ${pageHead("Global Task Monitoring", "Monitor all work, filter by project, manager, status, and focus overdue tasks.")}
        <section class="stat-grid">
            ${statCard("Total Tasks", superState.taskAnalytics?.total_tasks || superState.tasks.length, "fa-list-check")}
            ${statCard("Completed", superState.taskAnalytics?.completed_tasks || 0, "fa-circle-check")}
            ${statCard("Pending", superState.taskAnalytics?.pending_tasks || 0, "fa-hourglass-half")}
            ${statCard("Overdue", superState.taskAnalytics?.overdue_tasks || 0, "fa-triangle-exclamation")}
        </section>
        <div class="toolbar">
            <select onchange="setSuperFilter('taskProject', this.value)">
                ${option("all", "All projects", superState.filters.taskProject)}
                ${superState.projects.map(project => option(project.id, project.name || project.project_name, superState.filters.taskProject)).join("")}
            </select>
            <select onchange="setSuperFilter('taskManager', this.value)">
                ${option("all", "All managers", superState.filters.taskManager)}
                ${managers.map(manager => option(manager.email, manager.username || manager.email, superState.filters.taskManager)).join("")}
            </select>
            <select onchange="setSuperFilter('taskStatus', this.value)">
                ${option("all", "All status", superState.filters.taskStatus)}
                ${option("Pending", "Pending", superState.filters.taskStatus)}
                ${option("In Progress", "In Progress", superState.filters.taskStatus)}
                ${option("Completed", "Completed", superState.filters.taskStatus)}
                ${option("overdue", "Overdue only", superState.filters.taskStatus)}
            </select>
        </div>
        <section class="super-panel table-wrap">
            <table class="super-table">
                <thead><tr><th>Task</th><th>Project</th><th>Manager</th><th>Status</th><th>Due Date</th><th>Assignees</th></tr></thead>
                <tbody>
                    ${page.items.length ? page.items.map(task => {
                        const project = projectFor(task.project_id);
                        return `
                            <tr>
                                <td><strong>${escapeSuper(task.title || task.task_title || "Untitled")}</strong></td>
                                <td>${escapeSuper(project?.name || "Unknown")}</td>
                                <td>${escapeSuper(project?.assigned_manager || "Unassigned")}</td>
                                <td><span class="badge ${statusClass(task.status)}">${escapeSuper(task.status || "Pending")}</span></td>
                                <td>${formatDate(task.due_date || task.deadline)}</td>
                                <td>${escapeSuper((task.assigned_users || task.assigned_to || []).join(", ") || "Unassigned")}</td>
                            </tr>
                        `;
                    }).join("") : emptyRow(6, "No tasks found.")}
                </tbody>
            </table>
            ${paginationFooter("tasks", tasks.length, "tasks")}
        </section>
    `;
}

function renderAnalytics() {
    const data = superState.analytics || {};
    document.getElementById("superContent").innerHTML = `
        ${pageHead("Platform Analytics", "Growth, completion rate, active users, login activity, and AI usage statistics.")}
        <section class="stat-grid">
            ${statCard("Completion Rate", `${data.completion_rate || 0}%`, "fa-percent")}
            ${statCard("Active Users", data.active_users || 0, "fa-user-check")}
            ${statCard("AI Usage", data.ai_usage_statistics?.total || 0, "fa-robot")}
            ${statCard("Task Groups", Object.keys(data.task_status_distribution || {}).length, "fa-chart-pie")}
        </section>
        <section class="panel-grid">
            ${chartPanel("User Growth", "analyticsUsers")}
            ${chartPanel("Project Growth", "analyticsProjects")}
            ${chartPanel("Task Growth", "analyticsTasks")}
            ${chartPanel("Task Status Distribution", "analyticsStatus")}
            ${chartPanel("AI Usage Statistics", "analyticsAi")}
            ${chartPanel("Monthly Activity", "analyticsActivity")}
        </section>
    `;
    drawLineChart("analyticsUsers", data.user_growth || [], "Users");
    drawBarChart("analyticsProjects", data.project_growth || [], "Projects");
    drawLineChart("analyticsTasks", data.task_growth || [], "Tasks");
    drawPieChart("analyticsStatus", data.task_status_distribution || {});
    drawBarChart("analyticsAi", data.ai_usage_statistics?.monthly || [], "AI");
    drawLineChart("analyticsActivity", data.monthly_activity || [], "Activity");
}

function renderAuditLogs() {
    const logs = filteredAuditLogs();
    const page = paginateSuperItems("audit", logs);
    const actions = [...new Set(superState.auditLogs.map(log => log.action).filter(Boolean))].sort();
    document.getElementById("superContent").innerHTML = `
        ${pageHead("Audit Logs", "Track user, project, task, AI, login, role, and settings events.")}
        <div class="toolbar">
            <input type="search" placeholder="Search actor or description..." value="${escapeSuper(superState.search)}" oninput="handleSuperSearch(this.value)">
            <select onchange="setSuperFilter('auditAction', this.value)">
                ${option("all", "All actions", superState.filters.auditAction)}
                ${actions.map(action => option(action, action, superState.filters.auditAction)).join("")}
            </select>
        </div>
        <section class="super-panel table-wrap">
            <table class="super-table">
                <thead><tr><th>Timestamp</th><th>Action</th><th>User</th><th>Role</th><th>IP Address</th><th>Description</th></tr></thead>
                <tbody>
                    ${page.items.length ? page.items.map(log => `
                        <tr>
                            <td>${formatDateTime(log.timestamp)}</td>
                            <td><span class="badge">${escapeSuper(log.action || "-")}</span></td>
                            <td>${escapeSuper(log.user || log.user_email || "-")}</td>
                            <td>${labelRole(log.role || "-")}</td>
                            <td>${escapeSuper(log.ip_address || "-")}</td>
                            <td>${escapeSuper(log.description || "-")}</td>
                        </tr>
                    `).join("") : emptyRow(6, "No audit logs found.")}
                </tbody>
            </table>
            ${paginationFooter("audit", logs.length, "audit logs")}
        </section>
    `;
}

function renderSettings() {
    const settings = superState.settings || {};
    document.getElementById("superContent").innerHTML = `
        ${pageHead("System Settings", "Manage general, email, Gemini AI, notification, and security configuration.", `<button class="super-btn primary" onclick="saveSystemSettings()"><i class="fas fa-floppy-disk"></i>Save Settings</button>`)}
        <section class="settings-grid">
            ${settingsPanel("General Settings", [["system_name", "System Name"], ["logo", "Logo URL"]], settings.general)}
            ${settingsPanel("Email Settings", [["smtp_host", "SMTP Host"], ["smtp_port", "SMTP Port"], ["smtp_user", "SMTP User"], ["smtp_password", "SMTP Password"]], settings.email)}
            ${settingsPanel("Gemini AI Settings", [["api_key", "Gemini API Key"], ["model", "Model"]], settings.gemini_ai)}
            ${settingsPanel("Notification Settings", [["enabled", "Enabled"], ["retention_days", "Retention Days"]], settings.notifications)}
            ${settingsPanel("Security Settings", [["session_timeout", "Session Timeout"], ["password_policy", "Password Policy"]], settings.security)}
            ${listPanel("Platform Health Statistics", renderHealthList(settings.health))}
        </section>
    `;
    setHealth(settings.health);
}

function settingsPanel(title, fields, values = {}) {
    const groupMap = {
        "General Settings": "general",
        "Email Settings": "email",
        "Gemini AI Settings": "gemini_ai",
        "Notification Settings": "notifications",
        "Security Settings": "security"
    };
    const key = groupMap[title] || "general";
    return `
        <section class="super-panel">
            <div class="panel-head"><div><h3>${escapeSuper(title)}</h3><p>Super Admin only</p></div></div>
            <div class="field-grid">
                ${fields.map(([field, label]) => `
                    <label class="field">
                        <span>${escapeSuper(label)}</span>
                        <input data-settings-group="${escapeSuper(key)}" data-settings-field="${escapeSuper(field)}" value="${escapeSuper(values?.[field] ?? "")}">
                    </label>
                `).join("")}
            </div>
        </section>
    `;
}

function filteredUsers() {
    return filterBySearch(superState.users, ["username", "email", "role", "status"]).filter(user => {
        if (superState.filters.role !== "all" && user.role !== superState.filters.role) return false;
        if (superState.filters.status !== "all" && (user.status || "active") !== superState.filters.status) return false;
        return true;
    });
}

function filteredProjects() {
    return filterBySearch(superState.projects, ["name", "project_name", "assigned_manager", "status"]).filter(project => {
        return superState.filters.projectStatus === "all" || project.status === superState.filters.projectStatus;
    });
}

function filteredTasks() {
    return superState.tasks.filter(task => {
        const project = projectFor(task.project_id);
        const haystack = [task.title, task.task_title, task.status, project?.name, project?.assigned_manager].join(" ").toLowerCase();
        if (superState.search && !haystack.includes(superState.search)) return false;
        if (superState.filters.taskProject !== "all" && String(task.project_id) !== String(superState.filters.taskProject)) return false;
        if (superState.filters.taskManager !== "all" && String(project?.assigned_manager || "").toLowerCase() !== superState.filters.taskManager.toLowerCase()) return false;
        if (superState.filters.taskStatus === "overdue") return isOverdueTask(task);
        if (superState.filters.taskStatus !== "all" && task.status !== superState.filters.taskStatus) return false;
        return true;
    });
}

function filteredAuditLogs() {
    return superState.auditLogs.filter(log => {
        const haystack = [log.action, log.user, log.user_email, log.role, log.description, log.ip_address].join(" ").toLowerCase();
        if (superState.search && !haystack.includes(superState.search)) return false;
        if (superState.filters.auditAction !== "all" && log.action !== superState.filters.auditAction) return false;
        return true;
    });
}

function filterBySearch(items, fields) {
    if (!superState.search) return items;
    return items.filter(item => fields.some(field => String(item[field] || "").toLowerCase().includes(superState.search)));
}

function setSuperFilter(key, value) {
    superState.filters[key] = value;
    resetSuperPage(superState.view);
    renderSuperView();
}

function resetSuperPage(view) {
    const key = paginationKeyForView(view);
    if (key) superState.pagination[key] = 1;
}

function paginationKeyForView(view) {
    if (view === "users") return "users";
    if (view === "admins") return "admins";
    if (view === "projects") return "projects";
    if (view === "tasks") return "tasks";
    if (view === "audit") return "audit";
    return "";
}

function paginateSuperItems(key, items) {
    const total = items.length;
    const pageSize = superState.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(Math.max(Number(superState.pagination[key]) || 1, 1), totalPages);
    superState.pagination[key] = currentPage;
    const startIndex = (currentPage - 1) * pageSize;
    return {
        items: items.slice(startIndex, startIndex + pageSize),
        currentPage,
        totalPages,
        start: total ? startIndex + 1 : 0,
        end: Math.min(startIndex + pageSize, total)
    };
}

function paginationFooter(key, total, label) {
    const page = paginateSuperItems(key, Array.from({ length: total }));
    const previousDisabled = page.currentPage <= 1 ? "disabled" : "";
    const nextDisabled = page.currentPage >= page.totalPages ? "disabled" : "";
    return `
        <div class="super-pagination">
            <p>Showing ${formatNumber(page.start)} to ${formatNumber(page.end)} of ${formatNumber(total)} ${escapeSuper(label)}</p>
            <div class="super-pagination-controls" aria-label="${escapeSuper(label)} pagination">
                <button type="button" class="super-page-btn" onclick="setSuperPage('${key}', ${page.currentPage - 1})" ${previousDisabled} aria-label="Previous page">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <button type="button" class="super-page-btn active" aria-current="page">${formatNumber(page.currentPage)}</button>
                <button type="button" class="super-page-btn" onclick="setSuperPage('${key}', ${page.currentPage + 1})" ${nextDisabled} aria-label="Next page">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        </div>
    `;
}

function setSuperPage(key, page) {
    superState.pagination[key] = Math.max(1, Number(page) || 1);
    renderSuperView();
}

async function updateSuperUser(email, payload) {
    try {
        await superFetch(`/super-admin/users/${encodeURIComponent(email)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        });
        notifySuper("User updated");
        await loadSuperView("users");
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

async function resetSuperPassword(email) {
    if (!confirm(`Reset password for ${email}?`)) return;
    try {
        const data = await superFetch(`/super-admin/users/${encodeURIComponent(email)}/reset-password`, {
            method: "POST",
            body: JSON.stringify({})
        });
        alert(`Temporary password: ${data.temporary_password}`);
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

async function deleteSuperUser(email) {
    if (!confirm(`Delete ${email}?`)) return;
    try {
        await superFetch(`/super-admin/users/${encodeURIComponent(email)}`, { method: "DELETE" });
        notifySuper("User deleted", "warning");
        await loadSuperView("users");
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

function openAdminModal() {
    document.getElementById("superModalRoot").innerHTML = `
        <div class="modal-backdrop" onclick="closeSuperModal(event)">
            <form class="modal-card" onclick="event.stopPropagation()" onsubmit="createAdminAccount(event)">
                <div class="modal-head"><h3>Create Admin</h3><button class="icon-button" type="button" onclick="closeSuperModal()"><i class="fas fa-xmark"></i></button></div>
                <div class="modal-body">
                    <label class="field"><span>Name</span><input id="newAdminName" required></label>
                    <label class="field"><span>Email</span><input id="newAdminEmail" type="email" required></label>
                    <label class="field"><span>Password</span><input id="newAdminPassword" type="text" placeholder="Auto-generated if blank"></label>
                </div>
                <div class="modal-actions"><button class="super-btn" type="button" onclick="closeSuperModal()">Cancel</button><button class="super-btn primary" type="submit">Create</button></div>
            </form>
        </div>
    `;
}

function closeSuperModal(event) {
    if (event && !event.target.classList.contains("modal-backdrop")) return;
    document.getElementById("superModalRoot").innerHTML = "";
}

async function createAdminAccount(event) {
    event.preventDefault();
    const payload = {
        username: document.getElementById("newAdminName").value.trim(),
        email: document.getElementById("newAdminEmail").value.trim(),
        role: "admin",
        password: document.getElementById("newAdminPassword").value.trim() || null
    };
    try {
        const data = await superFetch("/admin-management/admins", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        closeSuperModal();
        notifySuper("Admin created");
        if (data.temporary_password) alert(`Temporary password: ${data.temporary_password}`);
        await loadSuperView("admins");
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

async function updateAdmin(email, payload) {
    try {
        await superFetch(`/admin-management/admins/${encodeURIComponent(email)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        });
        notifySuper("Admin updated");
        await loadSuperView("admins");
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

async function viewAdminActivity(email) {
    try {
        const [activity, performance] = await Promise.all([
            superFetch(`/admin-management/admins/${encodeURIComponent(email)}/activity`),
            superFetch(`/admin-management/admins/${encodeURIComponent(email)}/performance`)
        ]);
        document.getElementById("superModalRoot").innerHTML = `
            <div class="modal-backdrop" onclick="closeSuperModal(event)">
                <section class="modal-card" onclick="event.stopPropagation()">
                    <div class="modal-head"><h3>Admin Activity</h3><button class="icon-button" type="button" onclick="closeSuperModal()"><i class="fas fa-xmark"></i></button></div>
                    <div class="modal-body">
                        <div class="stat-grid">
                            ${statCard("Projects", performance.projects_managed, "fa-folder")}
                            ${statCard("Users", performance.users_managed, "fa-users")}
                            ${statCard("Tasks", performance.tasks_created, "fa-list-check")}
                            ${statCard("Last Login", formatDate(performance.last_login), "fa-clock")}
                        </div>
                        ${renderActivityList(activity)}
                    </div>
                </section>
            </div>
        `;
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

async function archiveProject(projectId) {
    try {
        await superFetch(`/super-admin/projects/${encodeURIComponent(projectId)}/archive`, { method: "PATCH" });
        notifySuper("Project archived", "warning");
        await loadSuperView("projects");
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

async function transferProject(projectId, managerEmail) {
    if (!managerEmail) return;
    try {
        await superFetch(`/super-admin/projects/${encodeURIComponent(projectId)}/transfer`, {
            method: "PATCH",
            body: JSON.stringify({ manager_email: managerEmail })
        });
        notifySuper("Project transferred");
        await loadSuperView("projects");
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

async function deleteProjectGlobal(projectId) {
    if (!confirm("Delete this project and its tasks?")) return;
    try {
        await superFetch(`/super-admin/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
        notifySuper("Project deleted", "warning");
        await loadSuperView("projects");
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

async function saveSystemSettings() {
    const payload = { general: {}, email: {}, gemini_ai: {}, notifications: {}, security: {} };
    document.querySelectorAll("[data-settings-group]").forEach(input => {
        const group = input.dataset.settingsGroup;
        const field = input.dataset.settingsField;
        if (!payload[group]) payload[group] = {};
        payload[group][field] = input.value;
    });
    try {
        const data = await superFetch("/system-settings", {
            method: "PUT",
            body: JSON.stringify(payload)
        });
        superState.settings = data.settings;
        notifySuper("Settings updated");
        renderSettings();
    } catch (error) {
        notifySuper(error.message, "error");
    }
}

function drawLineChart(id, rows, label) {
    drawChart(id, "line", rows.map(row => row.label), rows.map(row => row.value), label);
}

function drawBarChart(id, rows, label) {
    drawChart(id, "bar", rows.map(row => row.label), rows.map(row => row.value), label);
}

function drawPieChart(id, data) {
    const labels = Object.keys(data);
    const values = labels.map(label => data[label]);
    const ctx = document.getElementById(id);
    if (!ctx || typeof Chart === "undefined") return;
    superState.charts[id] = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: ["#0f766e", "#2563eb", "#16a34a", "#d97706", "#dc2626"] }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
}

function drawChart(id, type, labels, values, label) {
    const ctx = document.getElementById(id);
    if (!ctx || typeof Chart === "undefined") return;
    superState.charts[id] = new Chart(ctx, {
        type,
        data: {
            labels,
            datasets: [{
                label,
                data: values,
                borderColor: "#0f766e",
                backgroundColor: "rgba(15, 118, 110, 0.16)",
                borderWidth: 2,
                tension: 0.32,
                fill: type === "line"
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
}

function clearSuperCharts() {
    Object.values(superState.charts).forEach(chart => chart?.destroy?.());
    superState.charts = {};
}

function renderActivityList(items = []) {
    if (!items.length) return `<div class="super-empty">No activity available.</div>`;
    return `<div class="activity-list">${items.slice(0, 8).map(item => `
        <div class="activity-item">
            <div><strong>${escapeSuper(item.action || "Activity")}</strong><span>${escapeSuper(item.details || item.target || item.user_email || "")}</span></div>
            <span>${formatDateTime(item.timestamp)}</span>
        </div>
    `).join("")}</div>`;
}

function renderTopProjects(items = []) {
    if (!items.length) return `<div class="super-empty">No active projects yet.</div>`;
    return `<div class="activity-list">${items.map(item => `
        <div class="activity-item">
            <div><strong>${escapeSuper(item.project_name || "Project")}</strong><span>${escapeSuper(item.manager || "Unassigned")} · ${formatNumber(item.total_tasks)} tasks</span></div>
            ${progress(item.progress || 0)}
        </div>
    `).join("")}</div>`;
}

function renderHealthList(health = {}) {
    const rows = Object.entries(health || {}).filter(([key]) => key !== "checked_at");
    if (!rows.length) return `<div class="super-empty">Health data unavailable.</div>`;
    return `<div class="health-list">${rows.map(([key, value]) => `
        <div class="health-item"><strong>${labelText(key)}</strong><span>${escapeSuper(value)}</span></div>
    `).join("")}</div>`;
}

function projectFor(id) {
    return superState.projects.find(project => String(project.id) === String(id));
}

function progress(value) {
    const percent = Math.max(0, Math.min(Number(value) || 0, 100));
    return `<div class="progress-track" title="${percent}%"><div class="progress-fill" style="width:${percent}%"></div></div>`;
}

function userCell(user) {
    const name = user.username || user.name || user.email || "User";
    return `<div class="user-cell"><span class="avatar">${escapeSuper(name.charAt(0).toUpperCase())}</span><strong>${escapeSuper(name)}</strong></div>`;
}

function smallButton(label, action, icon, tone = "") {
    return `<button class="super-btn ${tone}" type="button" onclick="${action}" title="${escapeSuper(label)}"><i class="fas ${icon}"></i></button>`;
}

function option(value, label, selected) {
    return `<option value="${escapeSuper(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeSuper(label)}</option>`;
}

function emptyRow(colspan, text) {
    return `<tr><td colspan="${colspan}" class="super-empty">${escapeSuper(text)}</td></tr>`;
}

function setHealth(health) {
    const dot = document.getElementById("superHealthDot");
    if (!dot) return;
    dot.classList.toggle("online", health?.api === "operational" && health?.database === "operational");
}

function isOverdueTask(task) {
    const due = task.due_date || task.deadline;
    if (!due || task.status === "Completed") return false;
    const date = new Date(String(due).slice(0, 10) + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return !Number.isNaN(date.getTime()) && date < today;
}

function notifySuper(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `super-toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3600);
}

function logoutFromSuperAdmin() {
    if (typeof logout === "function") {
        logout();
        return;
    }
    sessionStorage.clear();
    window.location.href = "/";
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-IN");
}

function formatMetric(value) {
    if (typeof value === "number") return formatNumber(value);
    const numeric = Number(value);
    if (String(value || "").trim() !== "" && !Number.isNaN(numeric)) return formatNumber(numeric);
    return String(value ?? "0");
}

function formatBytes(value) {
    const size = Number(value || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function labelRole(role) {
    return labelText(role || "").replace("Super Admin", "Super Admin");
}

function labelText(value) {
    return String(value || "-").replace(/_/g, " ").split(" ").map(capitalize).join(" ");
}

function roleClass(role) {
    return String(role || "user").replace(/\s+/g, "_");
}

function statusClass(status) {
    const value = String(status || "").toLowerCase();
    if (value.includes("complete")) return "completed";
    if (value.includes("overdue")) return "overdue";
    if (value.includes("active")) return "active";
    return value.replace(/\s+/g, "-");
}

function capitalize(value) {
    const text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeSuper(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

window.initializeSuperAdmin = initializeSuperAdmin;
window.setSuperView = setSuperView;
window.handleSuperSearch = handleSuperSearch;
window.setSuperFilter = setSuperFilter;
window.updateSuperUser = updateSuperUser;
window.resetSuperPassword = resetSuperPassword;
window.deleteSuperUser = deleteSuperUser;
window.openAdminModal = openAdminModal;
window.closeSuperModal = closeSuperModal;
window.createAdminAccount = createAdminAccount;
window.updateAdmin = updateAdmin;
window.viewAdminActivity = viewAdminActivity;
window.archiveProject = archiveProject;
window.transferProject = transferProject;
window.deleteProjectGlobal = deleteProjectGlobal;
window.saveSystemSettings = saveSystemSettings;
window.logoutFromSuperAdmin = logoutFromSuperAdmin;
