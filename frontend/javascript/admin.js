const adminState = {
    users: [],
    projects: [],
    tasks: [],
    searchTerm: "",
    currentSection: "dashboard"
};

let projectStatusChart = null;
let taskOverviewChart = null;

function initializeAdminDashboard() {
    setProfileAvatar();
    refreshAdminData().then(() => {
        renderCurrentSection();
    });
    attachAdminMenuCloseHandler();
}

async function refreshAdminData() {
    const token = localStorage.getItem("token");

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
    const username = localStorage.getItem("username") || "Admin";
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
        if (!menu || menu.contains(event.target)) {
            return;
        }
        closeAdminProfileMenu();
    });
}

function logoutFromAdmin() {
    closeAdminProfileMenu();
    if (typeof logout === "function") {
        logout();
        return;
    }
    localStorage.clear();
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
    const tasks = filterCollection(stats.filteredTasks, (task) => [
        task.title,
        task.assigned_to,
        normalizeStatusLabel(task.status),
        stats.projectMap.get(String(task.project_id))?.name
    ]);

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view">
            <div class="view-header">
                <div>
                    <h3>Tasks</h3>
                </div>
            </div>
            <div class="data-panel">
                <div class="data-table-wrap">
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
                            ${tasks.length ? tasks.map((task) => renderTaskRow(task, stats.projectMap)).join("") : `<tr><td colspan="5" class="empty-state">No tasks found.</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
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
                                        ${user.email === localStorage.getItem("email") ? "<span class='disabled-action'>Current user</span>" : `<button class="action-btn delete-btn" type="button" onclick="deleteUser('${escapeHtml(user.email)}')">Delete</button>`}
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

async function deleteUser(email) {
    const token = localStorage.getItem("token");

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
    const stats = computeDashboardStats();
    const completedRate = stats.filteredTasks.length ? Math.round((stats.completedTasks / stats.filteredTasks.length) * 100) : 0;
    const activeProjects = stats.filteredProjects.filter((project) => {
        return stats.filteredTasks.some((task) => String(task.project_id) === String(project.id));
    }).length;
    const overdueCount = stats.filteredTasks.filter((task) => isOverdue(task.deadline)).length;

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view">
            <div class="view-header">
                <div>
                    <h3>Reports</h3>
                </div>
            </div>
            <div class="report-grid">
                <div class="report-card">
                    <h4>Completion Rate</h4>
                    <p>${completedRate}% of visible tasks are completed.</p>
                </div>
                <div class="report-card">
                    <h4>Active Projects</h4>
                    <p>${activeProjects} projects currently have assigned tasks.</p>
                </div>
                <div class="report-card">
                    <h4>Overdue Tasks</h4>
                    <p>${overdueCount} task${overdueCount === 1 ? " is" : "s are"} past the deadline.</p>
                </div>
            </div>
        </div>
    `;
}

function renderSettingsView() {
    const username = localStorage.getItem("username") || "Admin";
    const email = localStorage.getItem("email") || "Not available";

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
                    <span class="settings-badge">Live</span>
                </div>
            </div>
        </div>
    `;
}

function computeDashboardStats() {
    const filteredUsers = filterCollection(adminState.users, (user) => [user.username, user.email, user.role]);
    const filteredProjects = filterCollection(adminState.projects, (project) => [project.name, project.owner_email]);
    const filteredTasks = filterCollection(adminState.tasks, (task) => [task.title, task.assigned_to, task.status, task.deadline]);
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

function renderTaskRow(task, projectMap) {
    const project = projectMap.get(String(task.project_id));
    const label = normalizeStatusLabel(task.status);
    const className = statusClassName(task.status);

    return `
        <tr>
            <td>${escapeHtml(task.title || "Untitled Task")}</td>
            <td>${escapeHtml(project?.name || "Unknown Project")}</td>
            <td>${escapeHtml(task.assigned_to || "Unassigned")}</td>
            <td><span class="status-pill ${className}">${escapeHtml(label)}</span></td>
            <td>${escapeHtml(formatDate(task.deadline))}</td>
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

function updateNotificationCount() {
    const count = adminState.tasks.filter((task) => isPendingStatus(task.status) || isOverdue(task.deadline)).length;
    document.getElementById("notificationCount").innerText = count;
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

window.initializeAdminDashboard = initializeAdminDashboard;
window.handleAdminSearch = handleAdminSearch;
window.goToDashboard = goToDashboard;
window.goToProjects = goToProjects;
window.goToTasks = goToTasks;
window.goToUsers = goToUsers;
window.goToReports = goToReports;
window.goToSettings = goToSettings;
