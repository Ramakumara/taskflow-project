const adminState = {
    users: [],
    projects: [],
    tasks: [],
    notifications: [],
    searchTerm: "",
    currentSection: "dashboard"
};

let projectStatusChart = null;
let taskOverviewChart = null;
let adminReportStatusChart = null;
let adminReportProjectChart = null;

const adminReportState = {
    startDate: "",
    endDate: "",
    filteredProjects: [],
    filteredTasks: [],
    showAllProjects: false,
    showAllActivity: false
};
const adminTaskFilters = {
    projectId: "all",
    status: "all",
    page: 1,
    pageSize: 5
};

function getTaskAssignments(task) {
    if (Array.isArray(task?.assignments)) return task.assignments;
    if (Array.isArray(task?.assigned_statuses)) return task.assigned_statuses;

    const assigned = Array.isArray(task?.assigned_to)
        ? task.assigned_to
        : (task?.assigned_to ? [task.assigned_to] : []);

    return assigned.map(email => ({
        user_id: email,
        status: normalizeStatusLabel(task?.status)
    }));
}

function getTaskMembers(task) {
    return getTaskAssignments(task).map(assignment => String(assignment.user_id || "").trim()).filter(Boolean);
}

function renderAdminMemberStatuses(task) {
    const assignments = getTaskAssignments(task);
    if (!assignments.length) return `<span class="muted-text">Unassigned</span>`;
    const visibleAssignments = assignments.slice(0, 3);
    const hiddenAssignments = assignments.slice(3);

    return `
        <div class="admin-task-assignee-card">
            ${visibleAssignments.map(assignment => {
                const email = assignment.user_id || "Unassigned";
                const status = normalizeStatusLabel(assignment.status);
                const name = getAdminUserDisplayName(email);
                return `
                    <div class="admin-task-assignee-row" title="${escapeHtml(email)}: ${escapeHtml(status)}">
                        <span class="admin-task-avatar">${escapeHtml(getInitial(name || email))}</span>
                        <span class="admin-task-name">${escapeHtml(name)}</span>
                        <span class="admin-member-status ${statusClassName(status)}">
                            <i></i>${escapeHtml(status)}
                        </span>
                    </div>
                `;
            }).join("")}
            ${hiddenAssignments.length ? `
                <span class="admin-task-more" title="${escapeHtml(hiddenAssignments.map(assignment => {
                    const email = assignment.user_id || "Unassigned";
                    return `${getAdminUserDisplayName(email)} - ${normalizeStatusLabel(assignment.status)}`;
                }).join(", "))}">+ ${hiddenAssignments.length} more</span>
            ` : ""}
        </div>
    `;
}

function getAdminUserDisplayName(email) {
    const lookup = String(email || "").trim().toLowerCase();
    const user = adminState.users.find(item => String(item.email || "").trim().toLowerCase() === lookup);
    return user?.username || String(email || "Unassigned").split("@")[0] || "Unassigned";
}

function getInitial(value) {
    return String(value || "?").trim().charAt(0).toUpperCase() || "?";
}

function getTaskMemberStatusSearchText(task) {
    return getTaskAssignments(task)
        .map(assignment => `${assignment.user_id || ""} ${normalizeStatusLabel(assignment.status)}`)
        .join(" ");
}

function initializeAdminDashboard() {
    setProfileAvatar();
    refreshAdminData().then(() => {
        renderCurrentSection();
    });
    loadAdminNotifications();
    attachAdminMenuCloseHandler();
    setInterval(loadAdminNotifications, 30000);
}

async function refreshAdminData() {
    const token = sessionStorage.getItem("token");

    try {
        const [usersRes, projectsRes, tasksRes] = await Promise.all([
            fetch(`${BASE_URL}/users`, {
                headers: {
                    "Authorization": "Bearer " + token
                }
            }),
            fetch(`${BASE_URL}/projects`, {
                headers: {
                    "Authorization": "Bearer " + token
                }
            }),
            fetch(`${BASE_URL}/tasks`, {
                headers: {
                    "Authorization": "Bearer " + token
                }
            })
        ]);

        adminState.users = await usersRes.json();
        adminState.projects = await projectsRes.json();
        adminState.tasks = await tasksRes.json();
        updateNotificationCount();
    } catch (error) {
        console.error("Failed to load admin data", error);
        document.getElementById("mainContent").innerHTML = `
            <div class="data-panel">
                <h3>Unable to load dashboard</h3>
                <p>Please make sure the backend is running and try again.</p>
            </div>
        `;
    }
}

function setProfileAvatar() {
    const username = sessionStorage.getItem("username") || "Admin";
    const avatar = document.getElementById("profileAvatar");
    const encoded = encodeURIComponent(username);
    avatar.src = `https://ui-avatars.com/api/?name=${encoded}&background=3f7ec8&color=fff&bold=true`;
}

function handleAdminSearch(event) {
    adminState.searchTerm = (event.target.value || "").trim().toLowerCase();
    renderCurrentSection();
}

function setActiveNav(section) {
    adminState.currentSection = section;
    document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.section === section);
    });
}

function renderCurrentSection() {
    switch (adminState.currentSection) {
        case "projects":
            renderProjectsView();
            break;
        case "tasks":
            renderTasksView();
            break;
        case "users":
            renderUsersView();
            break;
        case "reports":
            renderReportsView();
            break;
        case "files":
            renderFilesView();
            break;
        case "settings":
            renderSettingsView();
            break;
        default:
            renderDashboardView();
            break;
    }
}

function goToDashboard() {
    closeAdminProfileMenu();
    setActiveNav("dashboard");
    renderDashboardView();
}

function goToProjects() {
    closeAdminProfileMenu();
    setActiveNav("projects");
    renderProjectsView();
}

function goToTasks() {
    closeAdminProfileMenu();
    setActiveNav("tasks");
    renderTasksView();
}

function goToUsers() {
    closeAdminProfileMenu();
    setActiveNav("users");
    renderUsersView();
}

function goToReports() {
    closeAdminProfileMenu();
    setActiveNav("reports");
    renderReportsView();
}

function goToFiles() {
    closeAdminProfileMenu();
    setActiveNav("files");
    renderFilesView();
}

function goToSettings() {
    closeAdminProfileMenu();
    setActiveNav("settings");
    renderSettingsView();
}

function toggleAdminProfileMenu(event) {
    event.stopPropagation();
    const dropdown = document.getElementById("profileDropdown");
    const button = document.getElementById("profileMenuButton");
    const isHidden = dropdown.classList.contains("hidden");

    dropdown.classList.toggle("hidden", !isHidden);
    button.setAttribute("aria-expanded", String(isHidden));
}

function closeAdminProfileMenu() {
    const dropdown = document.getElementById("profileDropdown");
    const button = document.getElementById("profileMenuButton");

    if (!dropdown || !button) {
        return;
    }

    dropdown.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
}

function attachAdminMenuCloseHandler() {
    document.addEventListener("click", (event) => {
        const menu = document.querySelector(".profile-menu");
        if (menu && !menu.contains(event.target)) {
            closeAdminProfileMenu();
        }

        const notificationWrap = document.getElementById("adminNotificationWrap");
        if (notificationWrap && !notificationWrap.contains(event.target)) {
            closeAdminNotifications();
        }
    });
}

function logoutFromAdmin() {
    closeAdminProfileMenu();
    if (typeof logout === "function") {
        logout();
        return;
    }
    sessionStorage.clear();
    window.location.href = "/";
}

function renderDashboardView() {
    const main = document.getElementById("mainContent");
    const stats = computeDashboardStats();
    const recentTasks = getRecentTasks(stats.filteredTasks);
    const upcomingDeadlines = getUpcomingDeadlines(stats.filteredTasks);

    main.innerHTML = `
        <div class="dashboard-view">
            <section class="stats-grid">
                <article class="stat-card blue">
                    <div class="stat-icon"><i class="fas fa-user"></i></div>
                    <div class="stat-text">
                        <span class="stat-label">Total Users</span>
                        <span class="stat-value"><strong>${stats.filteredUsers.length}</strong></span>
                    </div>
                </article>
                <article class="stat-card green">
                    <div class="stat-icon"><i class="fas fa-folder"></i></div>
                    <div class="stat-text">
                        <span class="stat-label">Total Projects</span>
                        <span class="stat-value"><strong>${stats.filteredProjects.length}</strong></span>
                    </div>
                </article>
                <article class="stat-card orange">
                    <div class="stat-icon"><i class="fas fa-square-check"></i></div>
                    <div class="stat-text">
                        <span class="stat-label">Tasks Completed</span>
                        <span class="stat-value"><strong>${stats.completedTasks}</strong></span>
                    </div>
                </article>
                <article class="stat-card red">
                    <div class="stat-icon"><i class="fas fa-clock"></i></div>
                    <div class="stat-text">
                        <span class="stat-label">Pending Tasks</span>
                        <span class="stat-value"><strong>${stats.pendingTasks}</strong></span>
                    </div>
                </article>
            </section>

            <section class="dashboard-grid">
                <article class="panel">
                    <h3>Project Status</h3>
                    <div class="chart-layout">
                        <div class="chart-canvas-wrap">
                            <canvas id="projectStatusChart"></canvas>
                        </div>
                        <div class="legend-list">
                            ${renderStatusLegend(stats.statusBreakdown)}
                        </div>
                    </div>
                </article>

                <article class="panel">
                    <h3>Tasks Overview</h3>
                    <div class="overview-chart-wrap">
                        <canvas id="tasksOverviewChart"></canvas>
                    </div>
                </article>
            </section>

            <section class="table-layout">
                <article class="table-panel">
                    <h3>Recent Tasks</h3>
                    <div class="table-scroll">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>Task</th>
                                    <th>Project</th>
                                    <th>Assigned To</th>
                                    <th>Status</th>
                                    <th>Due Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderRecentTasksRows(recentTasks, stats.projectMap)}
                            </tbody>
                        </table>
                    </div>
                </article>

                <aside class="deadlines-panel">
                    <h3>Upcoming Deadlines</h3>
                    <div class="deadlines-list">
                        ${renderDeadlines(upcomingDeadlines, stats.projectMap)}
                    </div>
                </aside>
            </section>
        </div>
    `;

    renderProjectStatusChart(stats.statusBreakdown);
    renderTaskOverviewChart(stats.weeklyOverview);
}

function renderProjectsView() {
    const filteredProjects = filterCollection(adminState.projects, (project) => [
        project.name,
        project.description,
        project.owner_email
    ]);

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view">
            <div class="view-header">
                <div>
                    <h3>Projects</h3>
                </div>
            </div>
            <div class="list-grid">
                ${filteredProjects.length ? filteredProjects.map((project) => renderProjectCard(project)).join("") : `<div class="data-panel empty-state">No projects found.</div>`}
            </div>
        </div>
    `;
}

function renderTasksView() {
    const stats = computeDashboardStats();
    const searchedTasks = filterCollection(stats.filteredTasks, (task) => [
        task.title,
        getTaskMemberStatusSearchText(task),
        normalizeStatusLabel(task.status),
        stats.projectMap.get(String(task.project_id))?.name
    ]);
    const tasks = searchedTasks.filter((task) => {
        if (adminTaskFilters.projectId !== "all" && String(task.project_id) !== String(adminTaskFilters.projectId)) return false;
        if (adminTaskFilters.status !== "all" && normalizeStatusLabel(task.status) !== adminTaskFilters.status) return false;
        return true;
    });
    const totalPages = Math.max(Math.ceil(tasks.length / adminTaskFilters.pageSize), 1);
    adminTaskFilters.page = Math.min(Math.max(adminTaskFilters.page, 1), totalPages);
    const startIndex = (adminTaskFilters.page - 1) * adminTaskFilters.pageSize;
    const pageTasks = tasks.slice(startIndex, startIndex + adminTaskFilters.pageSize);
    const projectOptions = stats.filteredProjects.map(project => `
        <option value="${escapeHtml(project.id)}" ${String(adminTaskFilters.projectId) === String(project.id) ? "selected" : ""}>
            ${escapeHtml(project.name || "Untitled Project")}
        </option>
    `).join("");

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view task-management-view">
            <div class="view-header task-management-head">
                <div>
                    <h3>My Tasks</h3>
                </div>
                <div class="admin-task-actions">
                    <select class="admin-task-filter" onchange="setAdminTaskProjectFilter(this.value)" aria-label="Filter tasks by project">
                        <option value="all">All Projects</option>
                        ${projectOptions}
                    </select>
                    <select class="admin-task-filter" onchange="setAdminTaskStatusFilter(this.value)" aria-label="Filter tasks by status">
                        <option value="all" ${adminTaskFilters.status === "all" ? "selected" : ""}>All Status</option>
                        <option value="Pending" ${adminTaskFilters.status === "Pending" ? "selected" : ""}>Pending</option>
                        <option value="In Progress" ${adminTaskFilters.status === "In Progress" ? "selected" : ""}>In Progress</option>
                        <option value="Completed" ${adminTaskFilters.status === "Completed" ? "selected" : ""}>Completed</option>
                    </select>
                </div>
            </div>
            <div class="data-panel task-table-panel">
                <div class="data-table-wrap">
                    <table class="admin-table admin-task-table">
                        <thead>
                            <tr>
                                <th>Task</th>
                                <th>Project</th>
                                <th>Assigned Users &amp; Status</th>
                                <th>Overall Status</th>
                                <th>Due Date</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pageTasks.length ? pageTasks.map((task) => renderTaskRow(task, stats.projectMap, { showAction: true })).join("") : `<tr><td colspan="6" class="empty-state">No tasks found.</td></tr>`}
                        </tbody>
                    </table>
                </div>
                <div class="admin-task-footer">
                    <span>${tasks.length ? `Showing ${startIndex + 1} to ${startIndex + pageTasks.length} of ${tasks.length} tasks` : "Showing 0 tasks"}</span>
                    <div class="admin-task-pagination-controls">
                        <button class="admin-task-page-btn" type="button" onclick="setAdminTaskPage(${adminTaskFilters.page - 1})" ${adminTaskFilters.page <= 1 ? "disabled" : ""} aria-label="Previous task page">
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <span class="admin-task-page-current">${adminTaskFilters.page}</span>
                        <button class="admin-task-page-btn" type="button" onclick="setAdminTaskPage(${adminTaskFilters.page + 1})" ${adminTaskFilters.page >= totalPages ? "disabled" : ""} aria-label="Next task page">
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setAdminTaskProjectFilter(value) {
    adminTaskFilters.projectId = value || "all";
    adminTaskFilters.page = 1;
    renderTasksView();
}

function setAdminTaskStatusFilter(value) {
    adminTaskFilters.status = value || "all";
    adminTaskFilters.page = 1;
    renderTasksView();
}

function setAdminTaskPage(page) {
    adminTaskFilters.page = page;
    renderTasksView();
}

async function adminDeleteTask(id) {
    await deleteTask(id);
    await refreshAdminData();
    renderTasksView();
}

function renderUsersView() {
    const users = filterCollection(adminState.users, (user) => [user.username, user.email, user.role]);

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view">
            <div class="view-header">
                <div>
                    <h3>Users</h3>
                </div>
            </div>
            <div class="data-panel">
                <div class="data-table-wrap">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${users.length ? users.map((user) => `
                                <tr>
                                    <td>${escapeHtml(user.username || "Unknown User")}</td>
                                    <td>${escapeHtml(user.email || "-")}</td>
                                    <td>${escapeHtml(capitalize(user.role || "user"))}</td>
                                    <td>
                                        ${user.email === sessionStorage.getItem("email") ? "<span class='disabled-action'>Current user</span>" : `
                                            <select class="admin-task-filter" aria-label="Change role for ${escapeHtml(user.email)}" onchange="changeUserRole('${escapeHtml(user.email)}', this.value)">
                                                <option value="user" ${String(user.role || "user").toLowerCase() === "user" ? "selected" : ""}>User</option>
                                                <option value="manager" ${String(user.role || "").toLowerCase() === "manager" ? "selected" : ""}>Manager</option>
                                                <option value="admin" ${String(user.role || "").toLowerCase() === "admin" ? "selected" : ""}>Admin</option>
                                            </select>
                                            <button class="action-btn delete-btn" type="button" onclick="deleteUser('${escapeHtml(user.email)}')">Delete</button>
                                        `}
                                    </td>
                                </tr>
                            `).join("") : `<tr><td colspan="4" class="empty-state">No users found.</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

async function changeUserRole(email, newRole) {
    const token = sessionStorage.getItem("token");

    if (!token) {
        alert("Login required.");
        return;
    }

    try {
        const res = await fetch(`${BASE_URL}/users/role?email=${encodeURIComponent(email)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({ new_role: newRole })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.detail || data.message || "Unable to update role");
        }

        await refreshAdminData();
        renderUsersView();
        showNotification(`Updated ${email} to ${capitalize(newRole)}`);
    } catch (error) {
        alert(error.message || "Unable to update role");
        await refreshAdminData();
        renderUsersView();
    }
}

async function deleteUser(email) {
    const token = sessionStorage.getItem("token");

    if (!token) {
        alert("Login required.");
        return;
    }

    if (!confirm(`Delete user ${email}?`)) {
        return;
    }

    try {
        const res = await fetch(`${BASE_URL}/users/${encodeURIComponent(email)}`, {
            method: "DELETE",
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        const data = await res.json();
        alert(data.message || "User deletion completed.");

        await refreshAdminData();
        renderCurrentSection();
    } catch (error) {
        console.error("Failed to delete user", error);
        alert("Unable to delete user.");
    }
}

function renderReportsView() {
    const { filteredProjects, filteredTasks } = getAdminReportData();
    const completed = filteredTasks.filter((task) => isCompletedStatus(task.status)).length;
    const inProgress = filteredTasks.filter((task) => isInProgressStatus(task.status)).length;
    const overdue = filteredTasks.filter((task) => isOverdue(task.deadline) && !isCompletedStatus(task.status)).length;
    const pending = Math.max(filteredTasks.length - completed - inProgress - overdue, 0);
    const activeUsers = new Set(filteredTasks.flatMap(getTaskMembers)).size;
    const inactiveUsers = Math.max(adminState.users.length - activeUsers, 0);
    const topProjects = getAdminTopProjectItems(filteredProjects, filteredTasks);
    const activityItems = getAdminUserActivityItems(filteredTasks);

    adminReportState.filteredProjects = filteredProjects;
    adminReportState.filteredTasks = filteredTasks;

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view admin-report-dashboard">
            <div class="view-header report-view-header">
                <div>
                    <h3>Reports</h3>
                    <p>Filter task and project performance by deadline date.</p>
                </div>
                <div class="admin-report-actions">
                    <label class="admin-date-field">
                        <span>Start</span>
                        <input id="admin-report-start-date" type="date" value="${escapeHtml(adminReportState.startDate)}" onchange="setAdminReportDateRange()">
                    </label>
                    <label class="admin-date-field">
                        <span>End</span>
                        <input id="admin-report-end-date" type="date" value="${escapeHtml(adminReportState.endDate)}" onchange="setAdminReportDateRange()">
                    </label>
                    <button class="action-btn secondary-btn" type="button" onclick="clearAdminReportDateRange()">
                        <i class="fas fa-rotate-left"></i>
                        Clear
                    </button>
                    <div class="admin-export-group">
                        <button class="action-btn export-btn" type="button" onclick="exportAdminReport('excel')">
                            <i class="fas fa-file-excel"></i>
                            Excel
                        </button>
                        <button class="action-btn export-btn" type="button" onclick="exportAdminReport('pdf')">
                            <i class="fas fa-file-pdf"></i>
                            PDF
                        </button>
                        <button class="action-btn export-btn" type="button" onclick="exportAdminReport('csv')">
                            <i class="fas fa-file-csv"></i>
                            CSV
                        </button>
                    </div>
                </div>
            </div>

            <section class="admin-report-kpis">
                ${renderAdminReportKpi("Total Users", adminState.users.length, "fas fa-users", "blue", "All registered users")}
                ${renderAdminReportKpi("Total Projects", filteredProjects.length, "far fa-folder", "green", getAdminReportRangeLabel())}
                ${renderAdminReportKpi("Total Tasks", filteredTasks.length, "far fa-square-check", "purple", "Filtered tasks")}
                ${renderAdminReportKpi("Tasks Completed", completed, "far fa-circle-check", "orange", `${filteredTasks.length ? Math.round((completed / filteredTasks.length) * 100) : 0}% of tasks`)}
            </section>

            <section class="admin-report-main-grid">
                <article class="admin-report-panel task-overview-panel">
                    <div class="admin-report-panel-head">
                        <h3>Task Overview</h3>
                        <select class="admin-report-select" aria-label="Task overview range">
                            <option>Daily</option>
                            <option>Weekly</option>
                            <option>Monthly</option>
                        </select>
                    </div>
                    <div class="admin-line-legend">
                        <span><i class="legend-line created"></i>Created</span>
                        <span><i class="legend-line completed"></i>Completed</span>
                        <span><i class="legend-line overdue"></i>Overdue</span>
                    </div>
                    <div class="admin-report-chart-wrap line">
                        <canvas id="adminReportProjectChart"></canvas>
                    </div>
                </article>

                <article class="admin-report-panel status-breakdown-panel">
                    <div class="admin-report-panel-head">
                        <h3>Tasks by Status</h3>
                    </div>
                    <div class="admin-status-layout">
                        <div class="admin-report-chart-wrap donut">
                            <canvas id="adminReportStatusChart"></canvas>
                            <div class="admin-donut-total">
                                <strong>${filteredTasks.length}</strong>
                                <span>Total</span>
                            </div>
                        </div>
                        <div class="admin-status-list">
                            ${renderAdminStatusItem("Completed", completed, filteredTasks.length, "completed")}
                            ${renderAdminStatusItem("In Progress", inProgress, filteredTasks.length, "progress")}
                            ${renderAdminStatusItem("Pending", pending, filteredTasks.length, "pending")}
                            ${renderAdminStatusItem("Overdue", overdue, filteredTasks.length, "overdue")}
                        </div>
                    </div>
                </article>
            </section>

            <section class="admin-report-bottom-grid">
                <article class="admin-report-panel">
                    <div class="admin-report-panel-head">
                        <h3>Top Active Projects</h3>
                        ${renderAdminShowToggle("projects", topProjects.length)}
                    </div>
                    <div class="table-scroll">
                        <table class="admin-compact-table">
                            <thead>
                                <tr>
                                    <th>Project</th>
                                    <th>Owner</th>
                                    <th>Members</th>
                                    <th>Tasks</th>
                                    <th>Completed</th>
                                    <th>Progress</th>
                                </tr>
                            </thead>
                            <tbody>${renderAdminTopProjectRows(topProjects)}</tbody>
                        </table>
                    </div>
                </article>

                <article class="admin-report-panel">
                    <div class="admin-report-panel-head">
                        <h3>User Activity Summary</h3>
                        ${renderAdminShowToggle("activity", activityItems.length)}
                    </div>
                    <div class="table-scroll">
                        <table class="admin-compact-table activity-table">
                            <thead>
                                <tr>
                                    <th>Activity</th>
                                    <th>Count</th>
                                    <th>Change</th>
                                </tr>
                            </thead>
                            <tbody>${renderAdminUserActivityRows(activityItems)}</tbody>
                        </table>
                    </div>
                </article>
            </section>
        </div>
    `;

    renderAdminReportCharts(filteredProjects, filteredTasks, { completed, inProgress, pending, overdue });
}

function getAdminReportData() {
    const startDate = adminReportState.startDate;
    const endDate = adminReportState.endDate;
    const visibleProjects = filterCollection(adminState.projects, (project) => [project.name, project.owner_email]);
    const visibleTasks = filterCollection(adminState.tasks, (task) => [task.title, getTaskMemberStatusSearchText(task), task.status, task.deadline]);
    const filteredTasks = filterAdminTasksByDate(visibleTasks, startDate, endDate);
    const hasDateFilter = Boolean(startDate || endDate);
    const taskProjectIds = new Set(filteredTasks.map((task) => String(task.project_id)));
    const filteredProjects = hasDateFilter
        ? visibleProjects.filter((project) => taskProjectIds.has(String(project.id)))
        : visibleProjects;

    return { filteredProjects, filteredTasks };
}

function setAdminReportDateRange() {
    const startInput = document.getElementById("admin-report-start-date");
    const endInput = document.getElementById("admin-report-end-date");
    let startDate = startInput?.value || "";
    let endDate = endInput?.value || "";

    if (startDate && endDate && startDate > endDate) {
        endDate = startDate;
        if (endInput) endInput.value = startDate;
    }

    adminReportState.startDate = startDate;
    adminReportState.endDate = endDate;
    renderReportsView();
}

function clearAdminReportDateRange() {
    adminReportState.startDate = "";
    adminReportState.endDate = "";
    renderReportsView();
}

function parseAdminReportDate(value, endOfDay = false) {
    if (!value) return null;
    const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getAdminTaskReportDate(task) {
    const value = task.deadline || task.created_at || task.updated_at || "";
    if (!value) return null;
    const date = String(value).length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function filterAdminTasksByDate(tasks, startDate, endDate) {
    const start = parseAdminReportDate(startDate);
    const end = parseAdminReportDate(endDate, true);

    if (!start && !end) return tasks;

    return tasks.filter((task) => {
        const taskDate = getAdminTaskReportDate(task);
        if (!taskDate) return false;
        if (start && taskDate < start) return false;
        if (end && taskDate > end) return false;
        return true;
    });
}

function getAdminReportRangeLabel() {
    const start = adminReportState.startDate ? formatDate(adminReportState.startDate) : "All";
    const end = adminReportState.endDate ? formatDate(adminReportState.endDate) : "All";
    return adminReportState.startDate || adminReportState.endDate ? `${start} to ${end}` : "All dates";
}

function renderAdminReportMetric(label, value, icon, color, detail = "") {
    return `
        <article class="admin-report-card ${color}">
            <div class="admin-report-icon"><i class="${icon}"></i></div>
            <div>
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
                ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
            </div>
        </article>
    `;
}

function renderAdminReportKpi(label, value, icon, color, detail = "") {
    return `
        <article class="admin-kpi-card">
            <div class="admin-kpi-icon ${color}"><i class="${icon}"></i></div>
            <div class="admin-kpi-copy">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
                <small><i class="fas fa-arrow-up"></i>${escapeHtml(detail)}</small>
            </div>
        </article>
    `;
}

function renderAdminStatusItem(label, count, total, type) {
    const percent = total ? ((count / total) * 100).toFixed(1) : "0.0";
    return `
        <div class="admin-status-row">
            <span><i class="status-dot ${type}"></i>${escapeHtml(label)}</span>
            <strong>${count} (${percent}%)</strong>
        </div>
    `;
}

function renderAdminShowToggle(section, total) {
    if (total <= 4) return "";

    const isExpanded = section === "projects"
        ? adminReportState.showAllProjects
        : adminReportState.showAllActivity;
    const label = isExpanded ? "Show Less" : "Show More";

    return `
        <button class="admin-show-toggle" type="button" onclick="toggleAdminReportList('${section}')">
            ${label}
        </button>
    `;
}

function toggleAdminReportList(section) {
    if (section === "projects") {
        adminReportState.showAllProjects = !adminReportState.showAllProjects;
    }

    if (section === "activity") {
        adminReportState.showAllActivity = !adminReportState.showAllActivity;
    }

    renderReportsView();
}

function renderAdminTopProjectRows(projectItems) {
    if (!projectItems.length) {
        return `<tr><td colspan="6" class="empty-state">No active projects found.</td></tr>`;
    }

    const visibleProjects = adminReportState.showAllProjects
        ? projectItems
        : projectItems.slice(0, 4);

    return visibleProjects.map((item) => `
        <tr>
            <td>${escapeHtml(item.project.name || "Untitled Project")}</td>
            <td>${escapeHtml(item.project.owner_email || "Unknown")}</td>
            <td>${item.members}</td>
            <td>${item.projectTasks.length}</td>
            <td>${item.completed}</td>
            <td>
                <div class="report-progress"><span style="width:${item.percent}%"></span></div>
                <strong class="progress-text">${item.percent}%</strong>
            </td>
        </tr>
    `).join("");
}

function getAdminTopProjectItems(projects, tasks) {
    return projects
        .map((project) => {
            const projectTasks = tasks.filter((task) => String(task.project_id) === String(project.id));
            const completed = projectTasks.filter((task) => isCompletedStatus(task.status)).length;
            const members = new Set(projectTasks.flatMap(getTaskMembers)).size;
            const percent = projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0;
            return { project, projectTasks, completed, members, percent };
        })
        .sort((a, b) => b.projectTasks.length - a.projectTasks.length || String(a.project.name || "").localeCompare(String(b.project.name || "")))
        .slice();
}

function getAdminUserActivityItems(tasks) {
    const taskMap = buildAdminTeamMap(tasks);

    return adminState.users
        .filter((user) => String(user.role || "").trim().toLowerCase() === "user")
        .map((user) => {
            const email = String(user.email || "").trim();
            const taskInfo = taskMap[email] || { total: 0, completed: 0 };
            const percent = taskInfo.total ? Math.round((taskInfo.completed / taskInfo.total) * 100) : 0;
            return {
                label: user.username || email || "Unknown User",
                email,
                total: taskInfo.total,
                completed: taskInfo.completed,
                percent
            };
        })
        .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function renderAdminUserActivityRows(activityItems) {
    if (!activityItems.length) {
        return `<tr><td colspan="3" class="empty-state">No user activity found.</td></tr>`;
    }

    const visibleItems = adminReportState.showAllActivity
        ? activityItems
        : activityItems.slice(0, 4);

    return visibleItems.map((item) => {
        const isActive = item.total > 0;
        return `
            <tr>
                <td>
                    <span class="activity-user-name">${escapeHtml(item.label)}</span>
                    <small>${escapeHtml(item.email || "No email")}</small>
                </td>
                <td>${item.total}</td>
                <td><span class="activity-change ${isActive ? "up" : "down"}"><i class="fas fa-arrow-${isActive ? "up" : "down"}"></i>${item.percent}%</span></td>
            </tr>
        `;
    }).join("");
}

function renderAdminActivityRow(label, count, direction, change) {
    const isUp = direction === "up";
    return `
        <tr>
            <td>${escapeHtml(label)}</td>
            <td>${count}</td>
            <td><span class="activity-change ${isUp ? "up" : "down"}"><i class="fas fa-arrow-${isUp ? "up" : "down"}"></i>${escapeHtml(change)}</span></td>
        </tr>
    `;
}

function renderAdminProjectReportRows(projects, tasks) {
    if (!projects.length) {
        return `<tr><td colspan="6" class="empty-state">No project data found for this report.</td></tr>`;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return projects.map((project) => {
        const projectTasks = tasks.filter((task) => String(task.project_id) === String(project.id));
        const total = projectTasks.length;
        const completed = projectTasks.filter((task) => isCompletedStatus(task.status)).length;
        const progress = projectTasks.filter((task) => isInProgressStatus(task.status)).length;
        const overdue = projectTasks.filter((task) => task.deadline && new Date(`${task.deadline}T00:00:00`) < today && !isCompletedStatus(task.status)).length;
        const percent = total ? Math.round((completed / total) * 100) : 0;

        return `
            <tr>
                <td>${escapeHtml(project.name || "Untitled Project")}</td>
                <td>${total}</td>
                <td>${completed}</td>
                <td>${progress}</td>
                <td>${overdue}</td>
                <td>
                    <div class="report-progress"><span style="width:${percent}%"></span></div>
                    ${percent}%
                </td>
            </tr>
        `;
    }).join("");
}

function renderAdminTeamReportRows(tasks) {
    const teamMap = buildAdminTeamMap(tasks);
    const users = Object.keys(teamMap).sort();

    if (!users.length) {
        return `<tr><td colspan="4" class="empty-state">No team data found for this report.</td></tr>`;
    }

    return users.map((email) => {
        const item = teamMap[email];
        const percent = item.total ? Math.round((item.completed / item.total) * 100) : 0;
        return `
            <tr>
                <td>${escapeHtml(email)}</td>
                <td>${item.total}</td>
                <td>${item.completed}</td>
                <td>
                    <div class="report-progress"><span style="width:${percent}%"></span></div>
                    ${percent}%
                </td>
            </tr>
        `;
    }).join("");
}

function renderAdminTaskReportRows(tasks, projectMap) {
    if (!tasks.length) {
        return `<tr><td colspan="5" class="empty-state">No tasks found for this report.</td></tr>`;
    }

    return tasks.map((task) => renderTaskRow(task, projectMap)).join("");
}

function buildAdminTeamMap(tasks) {
    return tasks.reduce((map, task) => {
        getTaskAssignments(task).forEach((assignment) => {
            const email = assignment.user_id || "Unassigned";
            if (!map[email]) {
                map[email] = { total: 0, completed: 0 };
            }
            map[email].total += 1;
            if (isCompletedStatus(assignment.status)) {
                map[email].completed += 1;
            }
        });
        return map;
    }, {});
}

function renderAdminReportCharts(projects, tasks, counts) {
    const statusCanvas = document.getElementById("adminReportStatusChart");
    const projectCanvas = document.getElementById("adminReportProjectChart");

    if (adminReportStatusChart) adminReportStatusChart.destroy();
    if (adminReportProjectChart) adminReportProjectChart.destroy();

    if (statusCanvas) {
        adminReportStatusChart = new Chart(statusCanvas, {
            type: "doughnut",
            data: {
                labels: ["Completed", "In Progress", "Pending", "Overdue"],
                datasets: [{
                    data: [counts.completed, counts.inProgress, counts.pending, counts.overdue],
                    backgroundColor: ["#1668f2", "#18b87a", "#f8a425", "#f04438"],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "70%",
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${context.parsed}`
                        }
                    }
                }
            }
        });
    }

    if (projectCanvas) {
        const overview = buildAdminTaskOverview(tasks);

        adminReportProjectChart = new Chart(projectCanvas, {
            data: {
                labels: overview.labels,
                datasets: [
                    {
                        type: "line",
                        label: "Created",
                        data: overview.created,
                        borderColor: "#1668f2",
                        backgroundColor: "#1668f2",
                        pointRadius: 2,
                        tension: 0.35
                    },
                    {
                        type: "line",
                        label: "Completed",
                        data: overview.completed,
                        borderColor: "#18b87a",
                        backgroundColor: "#18b87a",
                        pointRadius: 2,
                        tension: 0.35
                    },
                    {
                        type: "line",
                        label: "Overdue",
                        data: overview.overdue,
                        borderColor: "#f04438",
                        backgroundColor: "#f04438",
                        pointRadius: 2,
                        tension: 0.35
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: "#506078" },
                        grid: { color: "#edf1f6" }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: "#506078", maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }
}

function buildAdminTaskOverview(tasks) {
    const bucketMap = new Map();

    tasks.forEach((task) => {
        const taskDate = getAdminTaskReportDate(task);
        if (!taskDate) return;

        const key = [
            taskDate.getFullYear(),
            String(taskDate.getMonth() + 1).padStart(2, "0"),
            String(taskDate.getDate()).padStart(2, "0")
        ].join("-");

        if (!bucketMap.has(key)) {
            bucketMap.set(key, { created: 0, completed: 0, overdue: 0 });
        }

        const bucket = bucketMap.get(key);
        bucket.created += 1;
        if (isCompletedStatus(task.status)) bucket.completed += 1;
        if (isOverdue(task.deadline) && !isCompletedStatus(task.status)) bucket.overdue += 1;
    });

    const keys = Array.from(bucketMap.keys()).sort();
    const visibleKeys = keys.length ? keys.slice(-31) : [new Date().toISOString().slice(0, 10)];

    return {
        labels: visibleKeys.map(formatAdminChartDate),
        created: visibleKeys.map((key) => bucketMap.get(key)?.created || 0),
        completed: visibleKeys.map((key) => bucketMap.get(key)?.completed || 0),
        overdue: visibleKeys.map((key) => bucketMap.get(key)?.overdue || 0)
    };
}

function formatAdminChartDate(value) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
    });
}

function buildAdminReportRows() {
    const projects = adminReportState.filteredProjects;
    const tasks = adminReportState.filteredTasks;
    const completed = tasks.filter((task) => isCompletedStatus(task.status)).length;
    const inProgress = tasks.filter((task) => isInProgressStatus(task.status)).length;
    const overdue = tasks.filter((task) => isOverdue(task.deadline) && !isCompletedStatus(task.status)).length;
    const pending = Math.max(tasks.length - completed - inProgress - overdue, 0);
    const activeUsers = new Set(tasks.flatMap(getTaskMembers)).size;
    const inactiveUsers = Math.max(adminState.users.length - activeUsers, 0);
    const overview = buildAdminTaskOverview(tasks);
    const topProjects = getAdminTopProjectItems(projects, tasks);
    const rows = [
        ["TaskFlow Admin Report"],
        ["Date Range", adminReportState.startDate || "All", adminReportState.endDate || "All"],
        [],
        ["KPI Overview"],
        ["Metric", "Value"],
        ["Total Users", adminState.users.length],
        ["Total Projects", projects.length],
        ["Total Tasks", tasks.length],
        ["Completed Tasks", completed],
        [],
        ["Task Overview"],
        ["Date", "Created", "Completed", "Overdue"]
    ];

    overview.labels.forEach((label, index) => {
        rows.push([
            label,
            overview.created[index] || 0,
            overview.completed[index] || 0,
            overview.overdue[index] || 0
        ]);
    });

    rows.push(
        [],
        ["Tasks by Status"],
        ["Status", "Count", "Percentage"],
        ["Completed", completed, `${tasks.length ? ((completed / tasks.length) * 100).toFixed(1) : "0.0"}%`],
        ["In Progress", inProgress, `${tasks.length ? ((inProgress / tasks.length) * 100).toFixed(1) : "0.0"}%`],
        ["Pending", pending, `${tasks.length ? ((pending / tasks.length) * 100).toFixed(1) : "0.0"}%`],
        ["Overdue", overdue, `${tasks.length ? ((overdue / tasks.length) * 100).toFixed(1) : "0.0"}%`],
        [],
        ["Top Active Projects"],
        ["Project", "Owner", "Members", "Tasks", "Completed", "Progress"]
    );

    topProjects.forEach((item) => {
        rows.push([
            item.project.name || "Untitled Project",
            item.project.owner_email || "Unknown",
            item.members,
            item.projectTasks.length,
            item.completed,
            `${item.percent}%`
        ]);
    });

    rows.push(
        [],
        ["User Activity Summary"],
        ["Activity", "Count", "Change"],
        ["New Users", adminState.users.length, "20.0%"],
        ["Active Users", activeUsers, "15.6%"],
        ["Inactive Users", inactiveUsers, "-8.3%"],
        ["Users Over Limit", overdue, "-50.0%"]
    );

    return rows;
}

function exportAdminReport(format) {
    if (!adminState.users.length && !adminReportState.filteredProjects.length && !adminReportState.filteredTasks.length) {
        alert("No report data available to export.");
        return;
    }

    const rows = buildAdminReportRows();
    const rangeLabel = adminReportState.startDate || adminReportState.endDate
        ? `-${adminReportState.startDate || "start"}-to-${adminReportState.endDate || "end"}`
        : "";
    const filename = `taskflow-admin-report${rangeLabel}`;

    if (format === "excel" && window.XLSX) {
        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        worksheet["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Admin Report");
        XLSX.writeFile(workbook, `${filename}.xlsx`);
        return;
    }

    if (format === "pdf" && window.jspdf?.jsPDF) {
        exportAdminReportPdf(rows, filename);
        return;
    }

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    downloadAdminBlob(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
}

function exportAdminReportPdf(rows, filename) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    let currentY = 18;
    let headers = [];
    let body = [];

    doc.setFontSize(18);
    doc.text("TaskFlow Admin Report", 14, currentY);
    currentY += 10;
    doc.setFontSize(10);
    doc.text(`Date Range: ${adminReportState.startDate || "All"} to ${adminReportState.endDate || "All"}`, 14, currentY);
    currentY += 10;

    const flushTable = () => {
        if (!headers.length) return;
        doc.autoTable({
            startY: currentY,
            head: [headers],
            body,
            theme: "grid",
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [63, 126, 200] }
        });
        currentY = doc.lastAutoTable.finalY + 8;
        headers = [];
        body = [];
    };

    rows.slice(3).forEach((row) => {
        if (!row.length) return;
        if (row.length === 1) {
            flushTable();
            doc.setFontSize(12);
            doc.text(String(row[0]), 14, currentY);
            currentY += 6;
            return;
        }
        if (!headers.length) {
            headers = row;
        } else {
            body.push(row);
        }
    });

    flushTable();
    doc.save(`${filename}.pdf`);
}

function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadAdminBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

async function renderFilesView() {
    const token = sessionStorage.getItem("token");

    const res = await fetch(`${BASE_URL}/files`, {
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    const files = await res.json();

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view">
            <div class="view-header">
                <h3>All Files</h3>
            </div>

            <div class="data-panel">
                <div class="data-table-wrap">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>File</th>
                                <th>Owner</th>
                                <th>Size</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${files.length ? files.map(file => `
                                <tr>
                                    <td>${file.name}</td>
                                    <td>${file.owner_email || "Unknown"}</td>
                                    <td>${formatSize(file.size)}</td>
                                    <td>
                                        <button onclick="adminDownloadFile('${file.name}')">
                                            <i class="fas fa-download"></i>
                                        </button>
                                        <button onclick="adminDeleteFile('${file.name}')">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join("") : `
                                <tr><td colspan="4">No files found</td></tr>
                            `}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

async function adminDownloadFile(name) {
    const token = sessionStorage.getItem("token");

    const res = await fetch(`${BASE_URL}/files/download/${encodeURIComponent(name)}`, {
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
}
async function adminDeleteFile(name) {
    const token = sessionStorage.getItem("token");

    if (!confirm(`Delete ${name}?`)) return;

    const res = await fetch(`${BASE_URL}/files/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    if (res.ok) {
        alert("Deleted successfully");
        renderFilesView();
    } else {
        const data = await res.json();
        alert(data.detail || "Delete failed");
    }
}

function renderSettingsView() {
    const username = sessionStorage.getItem("username") || "Admin";
    const email = sessionStorage.getItem("email") || "Not available";

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view">
            <div class="view-header">
                <div>
                    <h3>Settings</h3>
                </div>
            </div>
            <div class="settings-list">
                <div class="settings-item">
                    <div>
                        <h4>Signed In User</h4>
                        <p>${escapeHtml(username)}</p>
                    </div>
                    <span class="settings-badge">Admin</span>
                </div>
                <div class="settings-item">
                    <div>
                        <h4>Account Email</h4>
                        <p>${escapeHtml(email)}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function computeDashboardStats() {
    const filteredUsers = filterCollection(adminState.users, (user) => [user.username, user.email, user.role]);
    const filteredProjects = filterCollection(adminState.projects, (project) => [project.name, project.owner_email]);
    const filteredTasks = filterCollection(adminState.tasks, (task) => [task.title, getTaskMemberStatusSearchText(task), task.status, task.deadline]);
    const projectMap = new Map(adminState.projects.map((project) => [String(project.id), project]));

    const completedTasks = filteredTasks.filter((task) => isCompletedStatus(task.status)).length;
    const pendingTasks = filteredTasks.filter((task) => isPendingStatus(task.status)).length;
    const statusBreakdown = buildProjectStatus(filteredTasks);
    const weeklyOverview = buildWeeklyTaskOverview(filteredTasks);

    return {
        filteredUsers,
        filteredProjects,
        filteredTasks,
        completedTasks,
        pendingTasks,
        statusBreakdown,
        weeklyOverview,
        projectMap
    };
}

function filterCollection(collection, extractFields) {
    if (!adminState.searchTerm) {
        return [...collection];
    }

    return collection.filter((item) => {
        const haystack = extractFields(item)
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        return haystack.includes(adminState.searchTerm);
    });
}

function buildProjectStatus(tasks) {
    const counts = { completed: 0, progress: 0, hold: 0 };

    tasks.forEach((task) => {
        if (isCompletedStatus(task.status)) {
            counts.completed += 1;
        } else if (isInProgressStatus(task.status)) {
            counts.progress += 1;
        } else {
            counts.hold += 1;
        }
    });

    const total = tasks.length || 1;

    return [
        {
            key: "completed",
            label: "Completed",
            value: counts.completed,
            percent: Math.round((counts.completed / total) * 100),
            color: "#35a65a"
        },
        {
            key: "progress",
            label: "In Progress",
            value: counts.progress,
            percent: Math.round((counts.progress / total) * 100),
            color: "#ffa21b"
        },
        {
            key: "hold",
            label: "On Hold",
            value: counts.hold,
            percent: Math.round((counts.hold / total) * 100),
            color: "#f24844"
        }
    ];
}

function buildWeeklyTaskOverview(tasks) {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const created = [0, 0, 0, 0, 0, 0, 0];
    const completed = [0, 0, 0, 0, 0, 0, 0];
    const trend = [0, 0, 0, 0, 0, 0, 0];

    tasks.forEach((task, index) => {
        const labelIndex = getTaskDayIndex(task, index);
        created[labelIndex] += 1;
        if (isCompletedStatus(task.status)) {
            completed[labelIndex] += 1;
        }
    });

    let running = 0;
    created.forEach((count, index) => {
        running += count;
        trend[index] = running;
    });

    return { labels, created, completed, trend };
}

function getTaskDayIndex(task, fallbackIndex) {
    const sources = [task.deadline, task.created_at, task.updated_at].filter(Boolean);

    for (const source of sources) {
        const date = new Date(source);
        if (!Number.isNaN(date.getTime())) {
            return (date.getDay() + 6) % 7;
        }
    }

    return fallbackIndex % 7;
}

function getRecentTasks(tasks) {
    return [...tasks]
        .sort((a, b) => compareDatesDesc(a.deadline, b.deadline) || String(a.title || "").localeCompare(String(b.title || "")))
        .slice(0, 4);
}

function getUpcomingDeadlines(tasks) {
    return [...tasks]
        .filter((task) => task.deadline)
        .sort((a, b) => compareDatesAsc(a.deadline, b.deadline))
        .slice(0, 3);
}

function renderStatusLegend(items) {
    return items.map((item) => `
        <div class="legend-item">
            <span class="legend-dot" style="background:${item.color}"></span>
            <div class="legend-copy">
                <span>${item.label}</span>
                <strong>${item.percent}%</strong>
            </div>
        </div>
    `).join("");
}

function renderRecentTasksRows(tasks, projectMap) {
    if (!tasks.length) {
        return `<tr><td colspan="5" class="empty-state">No task data available.</td></tr>`;
    }

    return tasks.map((task) => renderTaskRow(task, projectMap)).join("");
}

function renderTaskRow(task, projectMap, options = {}) {
    const project = projectMap.get(String(task.project_id));
    const label = normalizeStatusLabel(task.status);
    const className = statusClassName(task.status);

    return `
        <tr>
            <td>${escapeHtml(task.title || "Untitled Task")}</td>
            <td>${escapeHtml(project?.name || "Unknown Project")}</td>
            <td>${renderAdminMemberStatuses(task)}</td>
            <td><span class="status-pill ${className}">${escapeHtml(label)}</span></td>
            <td>${escapeHtml(formatDate(task.deadline))}</td>
            ${options.showAction ? `
                <td>
                    <button class="action-btn delete-btn" type="button" onclick="adminDeleteTask('${escapeHtml(task.id)}')">Delete</button>
                </td>
            ` : ""}
        </tr>
    `;
}

function renderDeadlines(tasks, projectMap) {
    if (!tasks.length) {
        return `<div class="empty-state">No upcoming deadlines.</div>`;
    }

    const colors = ["#3f7ec8", "#ff7f1f", "#26b37b"];

    return tasks.map((task, index) => {
        const project = projectMap.get(String(task.project_id));
        return `
            <div class="deadline-item">
                <span class="deadline-icon" style="background:${colors[index % colors.length]}"><i class="fas fa-check"></i></span>
                <div class="deadline-copy">
                    <strong>${escapeHtml(task.title || project?.name || "Upcoming task")}</strong>
                    <span>${escapeHtml(formatDate(task.deadline))}</span>
                </div>
            </div>
        `;
    }).join("");
}

function renderProjectCard(project) {
    const projectTasks = adminState.tasks.filter((task) => String(task.project_id) === String(project.id));
    const completedCount = projectTasks.filter((task) => isCompletedStatus(task.status)).length;

    return `
        <article class="mini-card">
            <h4>${escapeHtml(project.name || "Untitled Project")}</h4>
            <p>${escapeHtml(project.description || "No description available.")}</p>
            <span>Owner: ${escapeHtml(project.owner_email || "Unknown")}</span>
            <span>Tasks: ${projectTasks.length}</span>
            <span>Completed: ${completedCount}</span>
        </article>
    `;
}

function renderProjectStatusChart(items) {
    const canvas = document.getElementById("projectStatusChart");
    if (!canvas) {
        return;
    }

    if (projectStatusChart) {
        projectStatusChart.destroy();
    }

    projectStatusChart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: items.map((item) => item.label),
            datasets: [{
                data: items.map((item) => item.percent),
                backgroundColor: items.map((item) => item.color),
                borderWidth: 0,
                hoverOffset: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "58%",
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.label}: ${context.raw}%`
                    }
                }
            }
        }
    });
}

function renderTaskOverviewChart(overview) {
    const canvas = document.getElementById("tasksOverviewChart");
    if (!canvas) {
        return;
    }

    if (taskOverviewChart) {
        taskOverviewChart.destroy();
    }

    taskOverviewChart = new Chart(canvas, {
        data: {
            labels: overview.labels,
            datasets: [
                {
                    type: "bar",
                    label: "Created",
                    data: overview.created,
                    backgroundColor: "#2e6fc0",
                    borderRadius: 0,
                    barThickness: 20
                },
                {
                    type: "bar",
                    label: "Completed",
                    data: overview.completed,
                    backgroundColor: "#76a8e8",
                    borderRadius: 0,
                    barThickness: 20
                },
                {
                    type: "line",
                    label: "Trend",
                    data: overview.trend,
                    borderColor: "#f39b2c",
                    backgroundColor: "#f39b2c",
                    pointBackgroundColor: "#f39b2c",
                    pointBorderColor: "#f39b2c",
                    pointRadius: 4,
                    pointHoverRadius: 4,
                    borderWidth: 3,
                    tension: 0,
                    yAxisID: "y"
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: "#58647c",
                        font: { size: 13 }
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        color: "#58647c"
                    },
                    grid: {
                        color: "#e7ecf4"
                    }
                }
            }
        }
    });
}

async function loadAdminNotifications() {
    const token = sessionStorage.getItem("token");
    if (!token) return;

    try {
        const res = await fetch(`${BASE_URL}/notifications`, {
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        if (!res.ok) {
            throw new Error("Unable to load notifications");
        }

        const notifications = await res.json();
        adminState.notifications = Array.isArray(notifications) ? notifications : [];
        updateNotificationCount();
        renderAdminNotifications();
    } catch (error) {
        console.error("Failed to load admin notifications", error);
        renderAdminNotificationsError();
    }
}

function updateNotificationCount() {
    const badge = document.getElementById("notificationCount");
    if (!badge) return;

    const count = adminState.notifications.filter((notification) => !notification.read).length;
    badge.innerText = count;
    badge.classList.toggle("hidden", count === 0);
}

function toggleAdminNotifications(event) {
    event.stopPropagation();
    const dropdown = document.getElementById("adminNotificationDropdown");
    const button = document.getElementById("adminNotificationButton");
    if (!dropdown || !button) return;

    const isOpening = dropdown.classList.contains("hidden");
    dropdown.classList.toggle("hidden", !isOpening);
    button.classList.toggle("open", isOpening);
    button.setAttribute("aria-expanded", String(isOpening));

    if (isOpening) {
        loadAdminNotifications();
    }
}

function closeAdminNotifications() {
    const dropdown = document.getElementById("adminNotificationDropdown");
    const button = document.getElementById("adminNotificationButton");
    if (!dropdown || !button) return;

    dropdown.classList.add("hidden");
    button.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
}

function renderAdminNotifications() {
    const list = document.getElementById("adminNotificationList");
    if (!list) return;

    if (!adminState.notifications.length) {
        list.innerHTML = `<div class="notification-empty">No notifications yet.</div>`;
        return;
    }

    list.innerHTML = adminState.notifications.slice(0, 20).map((notification) => `
        <button class="notification-item ${notification.read ? "" : "unread"}" type="button" onclick="markAdminNotificationRead('${escapeHtml(notification.id)}')">
            <span class="notification-item-icon"><i class="fas fa-bell"></i></span>
            <span>
                <h4>${escapeHtml(notification.title || "Notification")}</h4>
                <p>${escapeHtml(notification.message || "")}</p>
                <small>${escapeHtml(formatAdminNotificationTime(notification.time || notification.created_at))}${notification.email ? ` - ${escapeHtml(notification.email)}` : ""}</small>
            </span>
        </button>
    `).join("");
}

function renderAdminNotificationsError() {
    const list = document.getElementById("adminNotificationList");
    if (!list) return;
    list.innerHTML = `<div class="notification-empty">Unable to load notifications.</div>`;
}

async function markAdminNotificationRead(id) {
    const token = sessionStorage.getItem("token");
    if (!token || !id) return;

    try {
        await fetch(`${BASE_URL}/notifications/${encodeURIComponent(id)}/read`, {
            method: "PUT",
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        adminState.notifications = adminState.notifications.map((notification) => (
            String(notification.id) === String(id)
                ? { ...notification, read: true }
                : notification
        ));
        updateNotificationCount();
        renderAdminNotifications();
    } catch (error) {
        console.error("Failed to mark notification read", error);
    }
}

async function markAllAdminNotificationsRead(event) {
    event.stopPropagation();
    const token = sessionStorage.getItem("token");
    if (!token) return;

    try {
        await fetch(`${BASE_URL}/notifications/read-all`, {
            method: "PUT",
            headers: {
                "Authorization": "Bearer " + token
            }
        });
        await loadAdminNotifications();
    } catch (error) {
        console.error("Failed to mark notifications read", error);
    }
}

function formatAdminNotificationTime(value) {
    if (!value) return "Just now";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

function isCompletedStatus(status) {
    return String(status || "").toLowerCase() === "done" || String(status || "").toLowerCase() === "completed";
}

function isInProgressStatus(status) {
    const normalized = String(status || "").toLowerCase();
    return normalized === "in progress" || normalized === "progress" || normalized === "in review" || normalized === "review";
}

function isPendingStatus(status) {
    const normalized = String(status || "").toLowerCase();
    return normalized === "todo" || normalized === "pending" || normalized === "on hold";
}

function statusClassName(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "done" || normalized === "completed") {
        return "completed";
    }
    if (normalized === "in review" || normalized === "review") {
        return "review";
    }
    if (normalized === "in progress" || normalized === "progress") {
        return "in-progress";
    }
    if (normalized === "pending" || normalized === "todo" || normalized === "on hold") {
        return normalized.replace(/\s+/g, "-");
    }
    return "pending";
}

function normalizeStatusLabel(status) {
    const normalized = String(status || "pending").toLowerCase();
    if (normalized === "todo") {
        return "Pending";
    }
    if (normalized === "done") {
        return "Completed";
    }
    return normalized.split(" ").map(capitalize).join(" ");
}

function capitalize(value) {
    const text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function compareDatesAsc(a, b) {
    const first = safeTime(a);
    const second = safeTime(b);
    return first - second;
}

function compareDatesDesc(a, b) {
    return compareDatesAsc(b, a);
}

function safeTime(value) {
    if (!value) {
        return Number.MAX_SAFE_INTEGER;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function formatDate(value) {
    if (!value) {
        return "No date";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function isOverdue(value) {
    if (!value) {
        return false;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatSize(size) {
    if (!size) return "-";
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
}

window.initializeAdminDashboard = initializeAdminDashboard;
window.handleAdminSearch = handleAdminSearch;
window.goToDashboard = goToDashboard;
window.goToProjects = goToProjects;
window.goToTasks = goToTasks;
window.goToUsers = goToUsers;
window.goToReports = goToReports;
window.goToFiles = goToFiles;
window.goToSettings = goToSettings;
window.toggleAdminNotifications = toggleAdminNotifications;
window.markAdminNotificationRead = markAdminNotificationRead;
window.markAllAdminNotificationsRead = markAllAdminNotificationsRead;
window.setAdminReportDateRange = setAdminReportDateRange;
window.clearAdminReportDateRange = clearAdminReportDateRange;
window.exportAdminReport = exportAdminReport;
window.toggleAdminReportList = toggleAdminReportList;
window.setAdminTaskProjectFilter = setAdminTaskProjectFilter;
window.setAdminTaskStatusFilter = setAdminTaskStatusFilter;
window.setAdminTaskPage = setAdminTaskPage;
window.adminDeleteTask = adminDeleteTask;
window.changeUserRole = changeUserRole;
window.deleteUser = deleteUser;
