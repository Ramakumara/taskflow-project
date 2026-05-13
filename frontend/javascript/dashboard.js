let allNotifications = [];
let currentFilter = "all";

const params = new URLSearchParams(window.location.search);

const token = params.get("token");
const role = params.get("role");
const username = params.get("username");
const email = params.get("email");

if (token) {
    sessionStorage.setItem("token", token);
    sessionStorage.setItem("role", role || "user");
    sessionStorage.setItem("username", username || "");
    sessionStorage.setItem("email", email || "");

    window.history.replaceState({}, document.title, "/dashboard-page");
}
    
// Hide all views
function hideAllViews() {
    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('tasks-view').classList.add('hidden');
    document.getElementById('team-view').classList.add('hidden');
    document.getElementById('calendar-view').classList.add('hidden');
    document.getElementById('activity-view').classList.add('hidden');
    document.getElementById('files-view').classList.add('hidden');
    document.getElementById('profile-view').classList.add('hidden');
    document.getElementById('settings-view').classList.add('hidden');
    document.getElementById('project-workspace-view').classList.add('hidden');
    document.getElementById('report-view').classList.add('hidden');
}

// Show specific view
function showView(viewId) {
    hideAllViews();
    const view = document.getElementById(viewId);
    if (view) {
        view.classList.remove('hidden');
    }
}

// Set active sidebar menu item
function setActiveMenu(menuName) {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`[data-sidebar="${menuName}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
}

function dashboard() {
    setActiveMenu('dashboard');
    showView('dashboard-view');
    loadProjects();
}

function setProjectTab(tab) {
    if (tab === 'activity-log' && sessionStorage.getItem("role") === "user") {
        dashboard();
        return;
    }

    switch(tab) {
        case 'overview':
            setActiveMenu('overview');
            showView('dashboard-view');
            loadProjects();
            break;
        case 'tasks':
            setActiveMenu('tasks');
            showView('tasks-view');
            loadAllTasks();
            break;
        case 'team':
            setActiveMenu('team');
            showView('team-view');
            loadTeamMembers();
            break;
        case 'calendar':
            setActiveMenu('calendar');
            showView('calendar-view');
            initializeCalendar();
            break;
        case 'activity-log':
            setActiveMenu('activity-log');
            showView('activity-view');
            loadActivityLog();
            break;
        case 'report':
            setActiveMenu('report');
            showView('report-view');
            loadReports();
            break;
        case 'files':
            setActiveMenu('files');
            showView('files-view');
            loadFiles();
            break;
        case 'settings':
            goToSettings();
            break;
    }
}

function goToSettings() {
    setActiveMenu('settings');
    showView('settings-view');
    loadSettingsView();
}

async function goToProfile() {
    setActiveMenu('');
    showView('profile-view');
    await loadDashboardProfile();
}

async function loadDashboardProfile() {
    const username = sessionStorage.getItem("username") || "User";
    const email = sessionStorage.getItem("email") || "";
    const role = sessionStorage.getItem("role") || "user";
    const token = sessionStorage.getItem("token");

    if (!email) {
        alert("No user data found. Please login again.");
        window.location.href = "/";
        return;
    }

    const initial = (username || email).charAt(0).toUpperCase();
    const roleText = role.charAt(0).toUpperCase() + role.slice(1);

    const binds = {
        "dashboard-profile-avatar-large": initial,
        "dashboard-profile-name": username,
        "dashboard-profile-role-text": roleText,
        "dashboard-profile-username": username,
        "dashboard-profile-email": email,
        "dashboard-profile-role": roleText
    };

    Object.entries(binds).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    });

    if (!token) return;

    try {
        const [projectsRes, tasksRes] = await Promise.all([
            fetch(`${BASE_URL}/projects`, {
                headers: { "Authorization": "Bearer " + token }
            }),
            fetch(`${BASE_URL}/tasks`, {
                headers: { "Authorization": "Bearer " + token }
            })
        ]);
        const projects = await projectsRes.json();
        const tasks = await tasksRes.json();
        
    } catch (error) {
        console.error("Failed to load profile summary", error);
    }
}

function loadSettingsView() {
    const themeSelect = document.getElementById("settings-theme-select");
    const languageSelect = document.getElementById("settings-language-select");
    if (themeSelect) themeSelect.value = sessionStorage.getItem("settings.theme") || "light";
    if (languageSelect) languageSelect.value = sessionStorage.getItem("settings.language") || "english";
    applySettingsPreferences();
}

function saveSettingsPreference(key, value) {
    sessionStorage.setItem(`settings.${key}`, String(value));
    applySettingsPreferences();
}

function getTaskAssignedBy(task, project) {
    return task.assigned_by || project?.owner_email || "Unknown";
}

function toggleQuietNotifications() {
    const nextValue = sessionStorage.getItem("settings.quietNotifications") !== "true";
    saveSettingsPreference("quietNotifications", nextValue);
}

function applySettingsPreferences() {
    const compactTables = sessionStorage.getItem("settings.compactTables") === "true";
    const quietNotifications = sessionStorage.getItem("settings.quietNotifications") === "true";
    const theme = sessionStorage.getItem("settings.theme") || "light";
    const language = sessionStorage.getItem("settings.language") || "english";
    document.body.classList.toggle("compact-dashboard-tables", compactTables);
    document.body.classList.toggle("quiet-dashboard-notifications", quietNotifications);
    document.body.classList.toggle("dashboard-theme-dark", getResolvedDashboardTheme(theme) === "dark");

    const notificationState = document.getElementById("settings-notification-state");
    if (notificationState) {
        notificationState.textContent = quietNotifications ? "Muted" : "On";
        notificationState.classList.toggle("muted", quietNotifications);
    }

    updateSettingsLanguage(language);
}

function getResolvedDashboardTheme(theme) {
    if (theme === "system") {
        return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
}

function updateSettingsLanguage(language) {
    const copy = {
        english: {
            title: "Settings",
            subtitle: "Manage your account and preferences.",
            profileTitle: "Profile",
            profileCopy: "View and update your personal information.",
            notificationsTitle: "Notifications",
            notificationsCopy: "Manage your notification preferences.",
            securityTitle: "Security",
            securityCopy: "Change your password and security settings.",
            appearanceTitle: "Appearance",
            appearanceCopy: "Choose your preferred theme.",
            languageTitle: "Language",
            languageCopy: "Select your preferred language."
        },
        hindi: {
            title: "सेटिंग्स",
            subtitle: "अपना खाता और पसंद प्रबंधित करें.",
            profileTitle: "प्रोफाइल",
            profileCopy: "अपनी व्यक्तिगत जानकारी देखें और अपडेट करें.",
            notificationsTitle: "सूचनाएं",
            notificationsCopy: "अपनी सूचना पसंद प्रबंधित करें.",
            securityTitle: "सुरक्षा",
            securityCopy: "अपना पासवर्ड और सुरक्षा सेटिंग्स बदलें.",
            appearanceTitle: "रूप",
            appearanceCopy: "अपनी पसंदीदा थीम चुनें.",
            languageTitle: "भाषा",
            languageCopy: "अपनी पसंदीदा भाषा चुनें."
        }
    };

    const selectedCopy = copy[language] || copy.english;
    document.querySelectorAll("[data-settings-text]").forEach(node => {
        const key = node.dataset.settingsText;
        if (selectedCopy[key]) node.textContent = selectedCopy[key];
    });
}

function goBack() {
    hideAllViews();
    document.getElementById('dashboard-view').classList.remove('hidden');
}

let activeTaskId = null;
let filesCache = [];
let filesTab = "all";
let filesCategory = "all";
let filesSort = "name-asc";
let filesLayout = "grid";
let filesPage = 1;
const filesPageSize = 10;
let assignableUsers = [];
let inlineAssignState = {};
let inlineAssignTarget = "";
let teamMemberCache = [];
let allUsersCache = [];
let teamWorkspaceCache = {
    projects: [],
    tasks: [],
    users: []
};

// Load all tasks for user
async function loadAllTasks() {
    const role = sessionStorage.getItem("role");
    const email = sessionStorage.getItem("email");
    const token = sessionStorage.getItem("token");

    if (!role || !email || !token) return;

    try {
        const [projectsRes, tasksRes] = await Promise.all([
            fetch(`${BASE_URL}/projects`, {
                headers: { "Authorization": "Bearer " + token }
            }),
            fetch(`${BASE_URL}/tasks`, {
                headers: { "Authorization": "Bearer " + token }
            })
        ]);

        const projects = await projectsRes.json();
        const tasks = await tasksRes.json();

        const list = document.getElementById("all-tasks-list");
        list.innerHTML = "";
        const assignedHeader = document.getElementById("all-tasks-assigned-header");
        if (assignedHeader) {
            assignedHeader.textContent = role === "user" ? "Assigned By" : "Assigned To";
        }

        if (tasks.length === 0) {
            list.innerHTML = `<tr><td colspan="5">No tasks assigned</td></tr>`;
            return;
        }

        tasks.forEach(t => {
            const project = projects.find(p => String(p.id) === String(t.project_id));
            const row = document.createElement("tr");
            const statusClass = t.status.trim().toLowerCase().replace(/\s+/g, "-");
            const assignedDisplay = role === "user" ? getTaskAssignedBy(t, project) : t.assigned_to;
            row.innerHTML = `
                <td>${t.title}</td>
                <td>${project?.name || "Unknown"}</td>
                <td>${assignedDisplay || "Unknown"}</td>
                <td><span class="status-pill ${statusClass}">${t.status}</span></td>
                <td>${t.deadline || "N/A"}</td>
                ${role === "admin" || role === "manager" ? `
                    <td>
                        <button class="delete-btn" type="button" onclick="deleteTask('${t.id}')">Delete</button>
                    </td>
                ` : ""}
            `;
            list.appendChild(row);
        });
    } catch (error) {
        console.error("Failed to load tasks", error);
    }
}

window.addEventListener("load", () => {
    const role = sessionStorage.getItem("role");

    if (role === "user") {
        // Hide header
        const header = document.getElementById("task-action-header");
        if (header) header.style.display = "none";

        // Hide all action column cells
        document.querySelectorAll("#all-tasks-list td:last-child").forEach(td => {
            td.style.display = "none";
        });
    }
});

// Load team members
async function loadTeamMembers() {
    const role = sessionStorage.getItem("role");
    const email = sessionStorage.getItem("email");
    const token = sessionStorage.getItem("token");

    if (!role || !email || !token) return;

    try {
        const workspaceRes = await fetch(`${BASE_URL}/projects/team-workspace`, {
            headers: { "Authorization": "Bearer " + token }
        });

        const workspace = await workspaceRes.json();
        const projects = workspace.projects;
        const tasks = workspace.tasks;
        const usersPayload = workspace.users;
        const users = Array.isArray(usersPayload) ? usersPayload : [];

        const teamList = document.getElementById("team-members-list");
        if (!teamList) return;

        if (!Array.isArray(projects) || !Array.isArray(tasks)) {
            teamList.innerHTML = `<div class="team-empty-state">Unable to load team members</div>`;
            return;
        }

        teamWorkspaceCache = { projects, tasks, users };
        allUsersCache = Array.isArray(users) ? users.slice() : [];
        teamMemberCache = users.slice();
        populateTeamProjectFilter(projects);
        renderTeamWorkspace();
    } catch (error) {
        console.error("Failed to load team members", error);
    }
}

function populateTeamProjectFilter(projects) {
    const filter = document.getElementById("teamProjectFilter");
    if (!filter) return;

    const role = sessionStorage.getItem("role");
    const userEmail = (sessionStorage.getItem("email") || "").trim().toLowerCase();
    const { tasks } = teamWorkspaceCache;

    const filteredProjects = role === "user"
        ? projects.filter(project => userBelongsToTeamProject(project, tasks, userEmail))
        : projects;

    const currentValue = filter.value || "all";
    filter.innerHTML = `<option value="all">All Projects</option>`;

    filteredProjects.forEach(project => {
        const option = document.createElement("option");
        option.value = String(project.id);
        option.textContent = project.name || "Untitled Project";
        filter.appendChild(option);
    });

    filter.value = Array.from(filter.options).some(option => option.value === currentValue)
        ? currentValue
        : "all";
}

function renderTeamWorkspace() {
    const list = document.getElementById("team-members-list");
    if (!list) return;

    const role = sessionStorage.getItem("role");
    const newProjectBtn = document.querySelector(".team-new-project-btn");
    if (newProjectBtn) {
        newProjectBtn.style.display = role === "manager" || role === "admin" ? "" : "none";
    }

    const query = (document.getElementById("teamSearchInput")?.value || "").trim().toLowerCase();
    const selectedProject = document.getElementById("teamProjectFilter")?.value || "all";
    const { projects, tasks, users } = teamWorkspaceCache;

    const userMap = new Map(
        users.map(user => [String(user.email || "").trim().toLowerCase(), user])
    );

    const userEmail = (sessionStorage.getItem("email") || "").trim().toLowerCase();

    let visibleProjects = projects.filter(project => {
        const matchesFilter =
            selectedProject === "all" || String(project.id) === String(selectedProject);

        if (role === "user") {
            return matchesFilter && userBelongsToTeamProject(project, tasks, userEmail);
        }

        return matchesFilter;
    });

    const sections = visibleProjects.map((project, index) => {

        const allProjectTasks = tasks.filter(task =>
            String(task.project_id) === String(project.id)
        );
        let projectTasks = allProjectTasks;

        // Search filter
        if (query) {
            projectTasks = projectTasks.filter(task => {
                const member = userMap.get(String(task.assigned_to || "").trim().toLowerCase());
                return [
                    project.name,
                    task.title,
                    task.assigned_to,
                    member?.username,
                    normalizeTeamStatus(task.status)
                ].some(value => String(value || "").toLowerCase().includes(query));
            });
        }

        const projectNameMatches = !query || String(project.name || "").toLowerCase().includes(query);
        const memberRows = buildTeamMemberRows(projectTasks, userMap);
        const memberCount = buildTeamMemberRows(allProjectTasks, userMap).length;

        if (!projectNameMatches && !projectTasks.length) return "";

        return `
            <section class="team-project-card">
                <div class="team-project-head">
                    <div class="team-project-title">
                        <span class="team-project-icon ${teamProjectColorClass(index)}">
                            <i class="fas fa-folder"></i>
                        </span>
                        <h3>${escapeTeamHtml(project.name || "Untitled Project")}</h3>
                        <span class="team-member-count">${memberCount} Member${memberCount === 1 ? "" : "s"}</span>
                    </div>
                </div>

                <div class="team-table-wrap">
                    <table class="team-table">
                        <thead>
                            <tr>
                                <th>Member</th>
                                <th>Email</th>
                            </tr>
                        </thead>
                       <tbody>
                        ${
                            (() => {
                                const uniqueMembers = Array.from(
                                    new Map(memberRows.map(m => [m.email, m])).values()
                                );

                                return role === "user"
                                    ? (
                                        uniqueMembers.length
                                        ? uniqueMembers.map(member => renderTeamMemberRow(member)).join("")
                                        : `
                                        <tr>
                                            <td colspan="2" class="team-empty-row">
                                                No members yet
                                            </td>
                                        </tr>
                                        `
                                    )
                                    : (
                                        uniqueMembers.length
                                        ? uniqueMembers.map(member => renderTeamMemberRow(member)).join("")
                                        : `
                                        <tr>
                                            <td colspan="2" class="team-empty-row">
                                                No members yet
                                            </td>
                                        </tr>
                                        `
                                    );
                            })()
                        }
                    </tbody>
                    </table>
                </div>

                ${role === "manager" ? `
                    <button class="team-add-member-btn" type="button" onclick="openTeamAddMember('${project.id}')">
                        <i class="fas fa-plus"></i>
                        <span>Add Member</span>
                    </button>
                ` : ""}
            </section>
        `;
    }).filter(Boolean);

    list.innerHTML = sections.length
        ? sections.join("")
        : `<div class="team-empty-state">No members found</div>`;
}

function userBelongsToTeamProject(project, tasks, userEmail) {
    return tasks.some(task =>
        String(task.project_id) === String(project.id) &&
        String(task.assigned_to || "").trim().toLowerCase() === userEmail
    );
}

function buildTeamMemberRows(tasks, userMap) {
    const members = new Map();

    tasks.forEach(task => {
        const email = String(task.assigned_to || "").trim().toLowerCase();
        if (!email || members.has(email)) return;

        const member = userMap.get(email) || {};
        const name = member.username || task.assigned_to || email;
        members.set(email, {
            email: task.assigned_to || email,
            name
        });
    });

    return Array.from(members.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function renderTeamMemberRow(member) {
    return `
        <tr>
            <td>
                <span class="team-member-cell">
                    <span class="team-avatar">${escapeTeamHtml(member.name.charAt(0).toUpperCase() || "?")}</span>
                    <span>${escapeTeamHtml(member.name)}</span>
                </span>
            </td>
            <td>${escapeTeamHtml(member.email || "Unassigned")}</td>
        </tr>
    `;
}

function renderTeamTaskRow(task, userMap) {
    const email = String(task.assigned_to || "").trim();
    const member = userMap.get(email.toLowerCase()) || {};
    const name = member.username || email || "Unassigned";
    const status = normalizeTeamStatus(task.status);

    return `
        <tr>
            <td>
                <span class="team-member-cell">
                    <span class="team-avatar">${escapeTeamHtml(name.charAt(0).toUpperCase() || "?")}</span>
                    <span>${escapeTeamHtml(name)}</span>
                </span>
            </td>
            <td>${escapeTeamHtml(email || "Unassigned")}</td>
        </tr>
    `;
}

function normalizeTeamStatus(status) {
    const value = String(status || "Pending").trim().toLowerCase();
    if (value === "done" || value === "completed") return "Completed";
    if (value === "in progress" || value === "progress") return "In Progress";
    return "Pending";
}

function teamStatusClass(status) {
    return String(status || "").toLowerCase().replace(/\s+/g, "-");
}

function teamProjectColorClass(index) {
    return ["blue", "pink", "green"][index % 3];
}

function openTeamAddMember(projectId) {
    sessionStorage.setItem("selectedProjectId", projectId);
    setActiveMenu("overview");
    showView("dashboard-view");
    openCreate();
    const projectSelect = document.getElementById("project-select");
    if (projectSelect) projectSelect.value = projectId;
}

function openTeamCreateProject() {
    setActiveMenu("overview");
    showView("dashboard-view");
    openCreate();
    const projectName = document.getElementById("project-name");
    if (projectName) projectName.focus();
}

function escapeTeamHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

let dashboardCalendarTasks = [];
let dashboardCalendarMonth = new Date().getMonth();
let dashboardCalendarYear = new Date().getFullYear();

function initializeCalendar() {
    const role = sessionStorage.getItem("role");
    const email = sessionStorage.getItem("email");
    const token = sessionStorage.getItem("token");

    if (!role || !email || !token) return;

    fetch(`${BASE_URL}/tasks`, {
        headers: { "Authorization": "Bearer " + token }
    })
        .then(res => res.json())
        .then(tasks => {
            dashboardCalendarTasks = tasks || [];
            renderDashboardCalendar();
            renderDashboardYearOptions();
        })
        .catch(error => console.error("Failed to load calendar", error));
}

function renderDashboardCalendar() {
    const calendarMonthYear = document.getElementById("calendar-month-year");
    const calendarDiv = document.getElementById("calendar");

    if (!calendarMonthYear || !calendarDiv) return;

    const currentMonth = new Date(dashboardCalendarYear, dashboardCalendarMonth);
    calendarMonthYear.textContent = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    calendarDiv.innerHTML = generateCalendarDays(dashboardCalendarTasks, dashboardCalendarMonth, dashboardCalendarYear);
}

function renderDashboardYearOptions() {
    const yearSelect = document.getElementById("calendar-year-select");

    if (!yearSelect) return;

    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 50;
    const endYear = currentYear + 50;
    yearSelect.innerHTML = '';

    for (let year = startYear; year <= endYear; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }

    yearSelect.value = dashboardCalendarYear;
}

function changeCalendarMonth(offset) {
    dashboardCalendarMonth += offset;

    if (dashboardCalendarMonth < 0) {
        dashboardCalendarMonth = 11;
        dashboardCalendarYear -= 1;
    }
    if (dashboardCalendarMonth > 11) {
        dashboardCalendarMonth = 0;
        dashboardCalendarYear += 1;
    }

    renderDashboardYearOptions();
    renderDashboardCalendar();
}

function onCalendarYearChange(event) {
    const selectedYear = parseInt(event.target.value, 10);
    if (!Number.isNaN(selectedYear)) {
        dashboardCalendarYear = selectedYear;
        renderDashboardCalendar();
    }
}

function generateCalendarDays(tasks, month, year) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    let html = '';
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    weekDays.forEach(day => {
        html += `<div class="calendar-weekday">${day}</div>`;
    });

    for (let i = 0; i < startingDayOfWeek; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const tasksOnDay = tasks.filter(t => t.deadline === dateStr);
        const hasTasks = tasksOnDay.length > 0;
        const today = new Date();
        const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

        html += `
            <div class="calendar-day ${hasTasks ? 'has-tasks' : ''} ${isToday ? 'today' : ''}">
                <div class="date-number">${day}</div>
                ${hasTasks ? `<div class="task-count">${tasksOnDay.length} task${tasksOnDay.length > 1 ? 's' : ''}</div>` : '<div class="task-count">No tasks</div>'}
            </div>
        `;
    }

    return html;
}

async function loadDashboardSummary() {
    const role = sessionStorage.getItem("role");
    const email = sessionStorage.getItem("email");
    const token = sessionStorage.getItem("token");

    try {
        const [projectsRes, tasksRes] = await Promise.all([
            fetch(`${BASE_URL}/projects`, {
                headers: { "Authorization": "Bearer " + token }
            }),
            fetch(`${BASE_URL}/tasks`, {
                headers: { "Authorization": "Bearer " + token }
            })
        ]);

        const projects = await projectsRes.json();
        const tasks = await tasksRes.json();

        let filteredProjects = projects;
        let filteredTasks = tasks;

        if (role === "user") {
            filteredTasks = tasks.filter(t => t.assigned_to === email);

            const projectIds = new Set(filteredTasks.map(t => t.project_id));

            filteredProjects = projects.filter(p => projectIds.has(p.id));
        }

        renderSummary(filteredProjects, filteredTasks);

    } catch (error) {
        console.error("Failed to load dashboard summary", error);
    }
}

function renderSummary(projects, tasks) {
    const totalProjects = document.getElementById("total-projects");
    const totalTasks = document.getElementById("total-tasks");
    const completionRate = document.getElementById("completion-rate");

    const completedTasks = tasks.filter(t => t.status === "done").length;
    const total = tasks.length;

    const percent = total === 0 ? 0 : Math.round((completedTasks / total) * 100);

    totalProjects.textContent = projects.length;
    totalTasks.textContent = tasks.length;
    completionRate.textContent = percent + "%";
}

async function loadProjectWorkspace() {
    const projectId = sessionStorage.getItem("selectedProjectId");
    const role = sessionStorage.getItem("role");
    const email = sessionStorage.getItem("email");

    if (!projectId || !role || !email) {
        return;
    }

    if (role !== "manager") {
        const actionHeader = document.getElementById("action-header");
        if (actionHeader) actionHeader.style.display = "none";
    }
    
    try {
        const token = sessionStorage.getItem("token");
        // Load project title
        const projectsRes = await fetch(`${BASE_URL}/projects`, {
            headers: { "Authorization": "Bearer " + token }
        });
        const projects = await projectsRes.json();
        const project = projects.find(p => String(p.id) === String(projectId));
        document.getElementById("project-title").innerText = project?.name || "Project";

        // Load project tasks
        const tasksRes = await fetch(`${BASE_URL}/tasks`, {
            headers: { "Authorization": "Bearer " + token }
        });
        const tasks = await tasksRes.json();
        
        const list = document.getElementById("task-list");
        list.innerHTML = "";
        const assignedHeader = document.getElementById("workspace-assigned-header");
        if (assignedHeader) {
            assignedHeader.textContent = role === "user" ? "Assigned By" : "Assigned To";
        }

        const projectTasks = tasks.filter(t =>
            String(t.project_id) === String(projectId)
        );

        if (projectTasks.length === 0) {
            list.innerHTML = `
                <tr>
                    <td colspan="5">No tasks available</td>
                </tr>
            `;
            return;
        }

        projectTasks.forEach(t => {
            const row = document.createElement("tr");
            const assignedDisplay = role === "user" ? getTaskAssignedBy(t, project) : t.assigned_to;

            row.innerHTML = `
                <td>${t.title}</td>
                <td>${assignedDisplay || "Unknown"}</td>
                <td>${t.deadline || "N/A"}</td>

                ${
                    role === "user"
                    ? `
                    <td>
                        <select onchange="updateStatus('${t.id}', this.value)">
                            <option value="todo" ${t.status === "todo" ? "selected" : ""}>To Do</option>
                            <option value="in progress" ${t.status === "in progress" ? "selected" : ""}>In Progress</option>
                            <option value="done" ${t.status === "done" ? "selected" : ""}>Done</option>
                        </select>
                    </td>
                    `
                    : `
                    <td>
                        <span class="status ${t.status.replace(" ", "-")}">
                            ${t.status}
                        </span>
                    </td>
                    `
                }

                ${
                    role === "manager"
                    ? `
                    <td>
                        <button class="delete-btn" type="button" onclick="deleteTask('${t.id}')">Delete</button>
                    </td>
                    `
                    : ""
                }
            `;

            list.appendChild(row);
        });

    } catch (error) {
        console.error("Failed to load project workspace", error);
    }
}

async function addTaskComment() {
    const token = sessionStorage.getItem("token");
    const input = document.getElementById("task-comment-input");
    if (!activeTaskId || !input) return;

    const content = input.value.trim();
    if (!content) {
        alert("Write a comment first");
        return;
    }

    const res = await fetch(`${BASE_URL}/tasks/${activeTaskId}/comments`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify({ content })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        alert(data.detail || data.message || "Unable to post comment");
        return;
    }

    input.value = "";
    loadTaskComments(activeTaskId);
}

function showProjectWorkspace() {
    hideAllViews();
    document.getElementById('project-workspace-view').classList.remove('hidden');
}

let activityExportState = {
    format: "excel"
};

function exportActivityLog() {
    openActivityExportModal();
}

function openActivityExportModal() {
    const modal = document.getElementById("activity-export-modal");
    if (!modal) return;

    setDefaultActivityExportDates();
    syncActivityExportModalUI();
    modal.classList.remove("hidden");
    document.body.classList.add("export-modal-open");
}

function closeActivityExportModal() {
    const modal = document.getElementById("activity-export-modal");
    if (!modal) return;

    modal.classList.add("hidden");
    document.body.classList.remove("export-modal-open");
}

function setDefaultActivityExportDates() {
    const startInput = document.getElementById("activity-export-start-date");
    const endInput = document.getElementById("activity-export-end-date");
    if (!startInput || !endInput || startInput.value || endInput.value) return;

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    startInput.value = toDateInputValue(start);
    endInput.value = toDateInputValue(end);
}

function toDateInputValue(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function selectActivityExportFormat(format) {
    activityExportState.format = format;
    syncActivityExportModalUI();
}

function syncActivityExportModalUI() {
    document.querySelectorAll("[data-activity-export-format]").forEach(card => {
        card.classList.toggle("selected", card.dataset.activityExportFormat === activityExportState.format);
    });
}

async function confirmActivityExport() {
    const token = sessionStorage.getItem("token");
    const startDate = document.getElementById("activity-export-start-date")?.value || "";
    const endDate = document.getElementById("activity-export-end-date")?.value || "";
    const includeDetails = document.getElementById("activity-export-detailed")?.checked ?? true;

    if (startDate && endDate && startDate > endDate) {
        alert("Start date cannot be after end date.");
        return;
    }

    try {
        const res = await fetch(`${BASE_URL}/activities`, {
            headers: { "Authorization": "Bearer " + token }
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            alert(error.message || error.detail || "Failed to export activity log.");
            return;
        }

        const logs = await res.json();
        const filteredLogs = filterActivityLogsByDate(Array.isArray(logs) ? logs : [], startDate, endDate);

        if (!filteredLogs.length) {
            alert("No activity records found for the selected date range.");
            return;
        }

        downloadActivityExport(filteredLogs, {
            format: activityExportState.format,
            startDate,
            endDate,
            includeDetails
        });
        closeActivityExportModal();
    } catch (error) {
        console.error(error);
        alert("Failed to export activity log.");
    }
}

function filterActivityLogsByDate(logs, startDate, endDate) {
    const start = parseReportDate(startDate);
    const end = parseReportDate(endDate, true);

    if (!start && !end) return logs;

    return logs.filter(log => {
        if (!log.timestamp) return false;
        const date = new Date(log.timestamp);
        if (Number.isNaN(date.getTime())) return false;
        if (start && date < start) return false;
        if (end && date > end) return false;
        return true;
    });
}

function formatActivityTime(timestamp) {

    const date = new Date(timestamp);

    return date.toLocaleString("en-IN", {

        timeZone: "Asia/Kolkata",

        day: "2-digit",

        month: "short",

        year: "numeric",

        hour: "2-digit",

        minute: "2-digit",

        second: "2-digit",

        hour12: true
    });
}

function downloadActivityExport(logs, options) {
    const rows = buildActivityExportRows(logs, options.includeDetails);
    const format = options.format || "csv";
    const rangeLabel = options.startDate || options.endDate ? `-${options.startDate || "start"}-to-${options.endDate || "end"}` : "";
    const filename = `taskflow-activity-log${rangeLabel}`;

    if (format === "pdf") {
        downloadActivityPdf(rows, filename);
        return;
    }

    if (format === "excel" && window.XLSX) {
        downloadActivityExcel(rows, filename);
        return;
    }

    const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
    const mimeType = "text/csv;charset=utf-8;";
    const blob = new Blob([csv], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `${filename}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function downloadActivityPdf(rows, filename) {
    if (!window.jspdf?.jsPDF) {
        alert("PDF library is not loaded. Please refresh and try again.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    let currentY = 18;
    let headers = [];
    let body = [];

    doc.setFontSize(18);
    doc.text("TaskFlow Activity Log", 14, currentY);
    currentY += 8;

    const flushTable = () => {
        if (!headers.length) return;

        doc.autoTable({
            startY: currentY,
            head: [headers],
            body,
            theme: "grid",
            styles: {
                fontSize: 8,
                cellPadding: 2,
                overflow: "linebreak"
            },
            headStyles: {
                fillColor: [47, 123, 255]
            },
            margin: { left: 10, right: 10 }
        });

        currentY = doc.lastAutoTable.finalY + 8;
        headers = [];
        body = [];
    };

    rows.forEach(row => {
        if (!row.length) return;

        if (row.length === 1) {
            flushTable();
            doc.setFontSize(13);
            doc.text(String(row[0]), 14, currentY);
            currentY += 7;
            return;
        }

        if (row.length === 2 && row[0] === "Exported At") {
            doc.setFontSize(10);
            doc.text(`Exported At: ${row[1]}`, 14, currentY);
            currentY += 8;
            return;
        }

        if (!headers.length) {
            headers = row;
            return;
        }

        body.push(row);
    });

    flushTable();
    doc.save(`${filename}.pdf`);
}

function downloadActivityExcel(rows, filename) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!cols"] = [
        { wch: 26 },
        { wch: 34 },
        { wch: 24 },
        { wch: 16 },
        { wch: 22 },
        { wch: 28 },
        { wch: 42 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Activity Log");
    XLSX.writeFile(workbook, `${filename}.xlsx`);
}

function buildActivityExportRows(logs, includeDetails) {
    const rows = [
        ["TaskFlow Activity Log"],
        ["Exported At", formatDateTime(new Date().toISOString())],
        [],
        includeDetails
            ? ["Timestamp", "User Email", "User Name", "Role", "Action", "Target", "Details"]
            : ["Timestamp", "User", "Action", "Details"]
    ];

    logs.forEach(log => {
        if (includeDetails) {
            rows.push([
                formatDateTime(log.timestamp),
                log.user_email || "",
                log.username || "",
                log.role || "",
                log.action || "",
                log.target || "",
                log.details || ""
            ]);
            return;
        }

        rows.push([
            formatDateTime(log.timestamp),
            log.user_email || log.username || "",
            log.action || "",
            [log.target, log.details].filter(Boolean).join(" - ")
        ]);
    });

    return rows;
}

let reportState = {
    projects: [],
    tasks: [],
    filteredProjects: [],
    filteredTasks: [],
    startDate: "",
    endDate: ""
};

let exportModalState = {
    sections: new Set(["projects", "overview", "tasks", "team"]),
    format: "excel"
};

let showAllProjects = false;
let showAllTeam = false;

function applyDashboardRoleVisibility() {
    const role = sessionStorage.getItem("role");
    const isUser = role === "user";
    const activityMenu = document.querySelector('[data-sidebar="activity-log"]');
    const activityExportCard = document.querySelector('[data-export-section="activity"]');

    if (activityMenu) {
        activityMenu.style.display = isUser ? "none" : "";
    }

    if (activityExportCard) {
        activityExportCard.style.display = isUser ? "none" : "";
    }

    if (isUser) {
        exportModalState.sections.delete("activity");
    }
}

function normalizeReportStatus(status) {
    return String(status || "").trim().toLowerCase();
}

function getReportDateFilters() {
    const startInput = document.getElementById("report-start-date");
    const endInput = document.getElementById("report-end-date");
    const startDate = startInput?.value || "";
    const endDate = endInput?.value || "";

    if (startDate && endDate && startDate > endDate) {
        if (endInput) endInput.value = startDate;
        return { startDate, endDate: startDate };
    }

    return { startDate, endDate };
}

function formatReportRangeDate(value) {
    if (!value) return "";

    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function formatReportChartDate(value) {
    if (!value || value === "No date") return value || "No date";
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
    });
}

function formatProjectChartLabel(name) {
    const words = String(name || "Untitled").split(" ").filter(Boolean);
    if (words.length <= 2) return words.join(" ");

    const midpoint = Math.ceil(words.length / 2);
    return [
        words.slice(0, midpoint).join(" "),
        words.slice(midpoint).join(" ")
    ];
}

function updateReportDateLabel() {
    const { startDate, endDate } = getReportDateFilters();
    const label = document.getElementById("report-date-label");
    if (!label) return;

    if (startDate && endDate) {
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T00:00:00`);
        const sameYear = start.getFullYear() === end.getFullYear();
        const startText = start.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: sameYear ? undefined : "numeric"
        });
        const endText = end.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
        label.textContent = `${startText} - ${endText}`;
        return;
    }

    if (startDate) {
        label.textContent = `From ${formatReportRangeDate(startDate)}`;
        return;
    }

    if (endDate) {
        label.textContent = `Until ${formatReportRangeDate(endDate)}`;
        return;
    }

    label.textContent = "All dates";
}

function toggleReportDatePicker(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("report-date-popover");
    if (popover) popover.classList.toggle("hidden");
}

function onReportDateChange() {
    updateReportDateLabel();
    loadReports();
}

function clearReportDateRange() {
    const startInput = document.getElementById("report-start-date");
    const endInput = document.getElementById("report-end-date");
    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
    updateReportDateLabel();
    loadReports();
}

window.addEventListener("click", event => {
    const popover = document.getElementById("report-date-popover");
    const dateControl = document.querySelector(".report-date-control");
    if (popover && dateControl && !popover.classList.contains("hidden") && !dateControl.contains(event.target)) {
        popover.classList.add("hidden");
    }
});

function parseReportDate(value, endOfDay = false) {
    if (!value) return null;

    const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getTaskReportDate(task) {
    const value = task.deadline || task.created_at || task.updated_at || "";
    if (!value) return null;

    const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function filterReportTasksByDate(tasks, startDate, endDate) {
    const start = parseReportDate(startDate);
    const end = parseReportDate(endDate, true);

    if (!start && !end) return tasks;

    return tasks.filter(task => {
        const taskDate = getTaskReportDate(task);
        if (!taskDate) return false;
        if (start && taskDate < start) return false;
        if (end && taskDate > end) return false;
        return true;
    });
}

async function loadReports() {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");
    const email = (sessionStorage.getItem("email") || "").trim().toLowerCase();

    try {
        const [projectsRes, tasksRes] = await Promise.all([
            fetch(`${BASE_URL}/projects`, {
                headers: { Authorization: "Bearer " + token }
            }),
            fetch(`${BASE_URL}/tasks`, {
                headers: { Authorization: "Bearer " + token }
            })
        ]);

        if (!projectsRes.ok || !tasksRes.ok) {
            throw new Error("Unable to load report data");
        }

        let projects = await projectsRes.json();
        let tasks = await tasksRes.json();

        if (!Array.isArray(projects)) projects = [];
        if (!Array.isArray(tasks)) tasks = [];

        if (role === "user") {
            tasks = tasks.filter(t => String(t.assigned_to || "").trim().toLowerCase() === email);

            const projectIds = new Set(tasks.map(t => String(t.project_id)));
            projects = projects.filter(p => projectIds.has(String(p.id)));
        }

        const { startDate, endDate } = getReportDateFilters();
        const filteredTasks = filterReportTasksByDate(tasks, startDate, endDate);
        const isDateFiltered = Boolean(startDate || endDate);
        const filteredProjectIds = new Set(filteredTasks.map(t => String(t.project_id)));
        const filteredProjects = isDateFiltered
            ? projects.filter(p => filteredProjectIds.has(String(p.id)))
            : projects;

        reportState = {
            projects,
            tasks,
            filteredProjects,
            filteredTasks,
            startDate,
            endDate
        };

        const totalProjects = filteredProjects.length;
        const totalTasks = filteredTasks.length;

        const completed = filteredTasks.filter(t => normalizeReportStatus(t.status) === "done").length;
        const inProgress = filteredTasks.filter(t => normalizeReportStatus(t.status) === "in progress").length;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const overdue = filteredTasks.filter(t =>
            t.deadline && new Date(`${t.deadline}T00:00:00`) < today && normalizeReportStatus(t.status) !== "done"
        ).length;

        const completedPercent = totalTasks ? ((completed / totalTasks) * 100).toFixed(0) : 0;
        const progressPercent = totalTasks ? ((inProgress / totalTasks) * 100).toFixed(0) : 0;
        const overduePercent = totalTasks ? ((overdue / totalTasks) * 100).toFixed(0) : 0;

        document.getElementById("report-total-projects").textContent = totalProjects;
        document.getElementById("report-total-tasks").textContent = totalTasks;
        document.getElementById("report-completed-tasks").textContent = completed;
        document.getElementById("report-inprogress-tasks").textContent = inProgress;
        document.getElementById("report-overdue-tasks").textContent = overdue;

        document.getElementById("report-completed-percent").textContent = completedPercent + "% of total tasks";
        document.getElementById("report-progress-percent").textContent = progressPercent + "% of total tasks";
        document.getElementById("report-overdue-percent").textContent = overduePercent + "% of total tasks";

        updateReportDateLabel();
        renderCharts(filteredProjects, filteredTasks, completed, inProgress, overdue);
        renderProjectSummary(filteredProjects, filteredTasks);
        renderTeamSummary(filteredTasks);

        const projectBtn = document.getElementById("view-all-projects");
        const teamBtn = document.getElementById("view-team-report");

        if (projectBtn) {
            projectBtn.onclick = (e) => {
                e.preventDefault();

                showAllProjects = !showAllProjects;

                renderProjectSummary(reportState.filteredProjects, reportState.filteredTasks);

                projectBtn.textContent = showAllProjects 
                    ? "Show less" 
                    : "View all projects";
            };
        }

        if (teamBtn) {
            teamBtn.onclick = (e) => {
                e.preventDefault();

                showAllTeam = !showAllTeam;

                renderTeamSummary(reportState.filteredTasks);

                teamBtn.textContent = showAllTeam 
                    ? "Show less" 
                    : "View full team report";
            };
        }

    } catch (error) {
        console.error("Report loading error:", error);
        const projectBody = document.getElementById("project-summary-body");
        const teamBody = document.getElementById("team-summary-body");
        if (projectBody) projectBody.innerHTML = `<tr><td colspan="6">Unable to load project report.</td></tr>`;
        if (teamBody) teamBody.innerHTML = `<tr><td colspan="4">Unable to load team report.</td></tr>`;
    }
}

function renderCards(p, t, c, i, o, cp, ip, op) {
    document.getElementById("report-cards").innerHTML = `
        <div class="card"><h4>Total Projects</h4><h2>${p}</h2></div>
        <div class="card"><h4>Total Tasks</h4><h2>${t}</h2></div>
        <div class="card green"><h4>Completed</h4><h2>${c}</h2><small>${cp}%</small></div>
        <div class="card orange"><h4>In Progress</h4><h2>${i}</h2><small>${ip}%</small></div>
        <div class="card red"><h4>Overdue</h4><h2>${o}</h2><small>${op}%</small></div>
    `;
}

function renderCharts(projects, tasks, completed, inProgress, overdue) {

    // destroy old charts
    Chart.getChart("statusChart")?.destroy();
    Chart.getChart("lineChart")?.destroy();
    Chart.getChart("priorityChart")?.destroy();

    const statusCtx = document.getElementById("statusChart");
    const lineCtx = document.getElementById("lineChart");
    const priorityCtx = document.getElementById("priorityChart");

    if (!statusCtx || !lineCtx || !priorityCtx) return;

    Chart.defaults.font.family = "Arial, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = "#0b1538";

    const totalTasks = tasks.length;
    const completedPercent = totalTasks ? Math.round((completed / totalTasks) * 100) : 0;
    const progressPercent = totalTasks ? Math.round((inProgress / totalTasks) * 100) : 0;
    const overduePercent = totalTasks ? Math.round((overdue / totalTasks) * 100) : 0;
    const statusLegend = document.getElementById("status-chart-legend");
    const statusTotal = document.getElementById("status-chart-total");
    const projectTotal = document.getElementById("project-chart-total");

    if (statusLegend) {
        statusLegend.innerHTML = `
            <div><span class="legend-dot blue"></span><strong>Completed</strong><small>${completed} (${completedPercent}%)</small></div>
            <div><span class="legend-dot orange"></span><strong>In Progress</strong><small>${inProgress} (${progressPercent}%)</small></div>
            <div><span class="legend-dot red"></span><strong>Overdue</strong><small>${overdue} (${overduePercent}%)</small></div>
        `;
    }
    if (statusTotal) statusTotal.textContent = `Total: ${totalTasks} task${totalTasks === 1 ? "" : "s"}`;
    if (projectTotal) projectTotal.textContent = `Total: ${totalTasks} task${totalTasks === 1 ? "" : "s"}`;

    // ===== STATUS =====
    new Chart(statusCtx, {
        type: "doughnut",
        data: {
            labels: ["Completed", "In Progress", "Overdue"],
            datasets: [{
                data: [completed, inProgress, overdue],
                backgroundColor: ["#20b864", "#f59e0b", "#dc2626"],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "54%",
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.label}: ${ctx.parsed} task${ctx.parsed === 1 ? "" : "s"}`
                    }
                }
            }
        }
    });

    // ===== LINE =====
    const map = {};
    tasks.forEach(t => {
        if (normalizeReportStatus(t.status) === "done") {
            const d = t.deadline || "No date";
            map[d] = (map[d] || 0) + 1;
        }
    });
    const sortedDates = Object.keys(map).sort();

    new Chart(lineCtx, {
        type: "line",
        data: {
            labels: sortedDates.map(formatReportChartDate),
            datasets: [{
                label: "Completed Tasks",
                data: sortedDates.map(date => map[date]),
                borderColor: "#20b864",
                backgroundColor: "rgba(32, 184, 100, 0.12)",
                pointBackgroundColor: "#20b864",
                pointBorderColor: "#20b864",
                pointRadius: 4,
                pointHoverRadius: 5,
                tension: 0.35,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false }, ticks: { color: "#0b1538" } },
                y: { beginAtZero: true, grid: { color: "#e7edf6" }, ticks: { color: "#34405f", precision: 0 } }
            },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { usePointStyle: true, boxWidth: 8, color: "#27365f" }
                }
            }
        }
    });

    const projectLabels = [];
    const projectCounts = [];
    (projects || []).forEach(project => {
        const count = tasks.filter(task => String(task.project_id) === String(project.id)).length;
        if (count > 0) {
            projectLabels.push(formatProjectChartLabel(project.name || "Untitled Project"));
            projectCounts.push(count);
        }
    });

    new Chart(priorityCtx, {
        type: "bar",
        data: {
            labels: projectLabels,
            datasets: [{
                label: "Tasks",
                data: projectCounts,
                backgroundColor: ["#20b864", "#159653", "#14b8a6", "#f59e0b", "#64748b", "#dc2626"],
                borderRadius: 4,
                maxBarThickness: 38
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false }, ticks: { color: "#0b1538", maxRotation: 0, minRotation: 0 } },
                y: { beginAtZero: true, grid: { color: "#e7edf6" }, ticks: { color: "#34405f", precision: 0 } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderProjectSummary(projects, tasks) {
    const body = document.getElementById("project-summary-body");
    if (!body) return;

    const displayProjects = showAllProjects ? projects : projects.slice(0, 4);

    let html = "";

    displayProjects.forEach(p => {
        const projectTasks = tasks.filter(t => String(t.project_id) === String(p.id));

        const total = projectTasks.length;
        const completed = projectTasks.filter(t => normalizeReportStatus(t.status) === "done").length;
        const inProgress = projectTasks.filter(t => normalizeReportStatus(t.status) === "in progress").length;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const overdue = projectTasks.filter(t =>
            t.deadline && new Date(`${t.deadline}T00:00:00`) < today && normalizeReportStatus(t.status) !== "done"
        ).length;

        const percent = total ? Math.round((completed / total) * 100) : 0;

        html += `
        <tr>
            <td>${p.name}</td>
            <td>${total}</td>
            <td>${completed}</td>
            <td>${inProgress}</td>
            <td>${overdue}</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-fill" style="width:${percent}%"></div>
                </div>
                ${percent}%
            </td>
        </tr>`;
    });

    body.innerHTML = html || `<tr><td colspan="6">No project data found for this report.</td></tr>`;
}

function renderTeamSummary(tasks) {
    const body = document.getElementById("team-summary-body");
    if (!body) return;

    const map = {};

    tasks.forEach(t => {
        const user = t.assigned_to || "Unknown";

        if (!map[user]) {
            map[user] = { total: 0, completed: 0 };
        }

        map[user].total++;
        if (normalizeReportStatus(t.status) === "done") map[user].completed++;
    });

    const users = Object.keys(map);
    const displayUsers = showAllTeam ? users : users.slice(0, 4);

    let html = "";

    displayUsers.forEach(user => {
        const total = map[user].total;
        const completed = map[user].completed;
        const percent = total ? Math.round((completed / total) * 100) : 0;

        const shortEmail = user.length > 17 
            ? user.substring(0, 17) + "..." 
            : user;

        html += `
        <tr>
            <td class="member-cell">
                <span class="avatar">${user[0].toUpperCase()}</span>
                <span title="${user}">${shortEmail}</span>
            </td>
            <td>${completed}</td>
            <td>${total}</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-fill" style="width:${percent}%"></div>
                </div>
                ${percent}%
            </td>
        </tr>`;
    });

    body.innerHTML = html || `<tr><td colspan="4">No team data found for this report.</td></tr>`;
}

function openExportModal() {
    const modal = document.getElementById("export-report-modal");
    if (!modal) return;

    applyDashboardRoleVisibility();
    syncExportModalUI();
    modal.classList.remove("hidden");
    document.body.classList.add("export-modal-open");
}

function closeExportModal() {
    const modal = document.getElementById("export-report-modal");
    if (!modal) return;

    modal.classList.add("hidden");
    document.body.classList.remove("export-modal-open");
}

function toggleExportSection(section) {
    if (exportModalState.sections.has(section)) {
        exportModalState.sections.delete(section);
    } else {
        exportModalState.sections.add(section);
    }

    syncExportModalUI();
}

function selectExportFormat(format) {
    exportModalState.format = format;
    syncExportModalUI();
}

function syncExportModalUI() {
    document.querySelectorAll("[data-export-section]").forEach(card => {
        card.classList.toggle("selected", exportModalState.sections.has(card.dataset.exportSection));
    });

    document.querySelectorAll("[data-export-format]").forEach(card => {
        card.classList.toggle("selected", card.dataset.exportFormat === exportModalState.format);
    });
}

async function confirmReportExport() {
    if (!exportModalState.sections.size) {
        alert("Please select at least one report section.");
        return;
    }

    await exportCSV({
        sections: Array.from(exportModalState.sections),
        format: exportModalState.format,
        includeCharts: document.getElementById("export-include-charts")?.checked ?? true
    });
}

async function exportCSV(options = {}) {
    const { filteredProjects, filteredTasks, startDate, endDate } = reportState;
    const sections = new Set(options.sections || ["projects", "overview", "tasks", "team"]);
    const format = options.format || "csv";

    if (sessionStorage.getItem("role") === "user") {
        sections.delete("activity");
    }

    if (!Array.isArray(filteredTasks) || !filteredTasks.length) {
        alert("No report data available to export.");
        return;
    }

    const projectById = new Map((filteredProjects || []).map(project => [String(project.id), project.name || "Untitled Project"]));
    const completed = filteredTasks.filter(t => normalizeReportStatus(t.status) === "done").length;
    const inProgress = filteredTasks.filter(t => normalizeReportStatus(t.status) === "in progress").length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = filteredTasks.filter(t =>
        t.deadline && new Date(`${t.deadline}T00:00:00`) < today && normalizeReportStatus(t.status) !== "done"
    ).length;

    const rows = [
        ["TaskFlow Report"],
        ["Date Range", startDate || "All", endDate || "All"]
    ];

    if (sections.has("overview")) {
        rows.push(
            [],
            ["Reports Overview"],
            ["Metric", "Value"],
            ["Total Projects", filteredProjects.length],
            ["Total Tasks", filteredTasks.length],
            ["Completed Tasks", completed],
            ["In Progress Tasks", inProgress],
            ["Overdue Tasks", overdue]
        );
    }

    if (sections.has("projects")) {
        rows.push(
            [],
            ["Projects Summary"],
            ["Project", "Total Tasks", "Completed", "In Progress", "Overdue", "Completion"]
        );

        filteredProjects.forEach(project => {
            const projectTasks = filteredTasks.filter(task => String(task.project_id) === String(project.id));
            const total = projectTasks.length;
            const projectCompleted = projectTasks.filter(task => normalizeReportStatus(task.status) === "done").length;
            const projectProgress = projectTasks.filter(task => normalizeReportStatus(task.status) === "in progress").length;
            const projectOverdue = projectTasks.filter(task =>
                task.deadline && new Date(`${task.deadline}T00:00:00`) < today && normalizeReportStatus(task.status) !== "done"
            ).length;
            const percent = total ? Math.round((projectCompleted / total) * 100) : 0;

            rows.push([
                project.name || "Untitled Project",
                total,
                projectCompleted,
                projectProgress,
                projectOverdue,
                `${percent}%`
            ]);
        });
    }

    if (sections.has("tasks")) {
        rows.push(
            [],
            ["Tasks Summary"],
            ["Project", "Task", "Assigned To", "Status", "Deadline"]
        );

        filteredTasks.forEach(task => {
            rows.push([
                projectById.get(String(task.project_id)) || "Unknown Project",
                task.title || "Untitled Task",
                task.assigned_to || "Unassigned",
                task.status || "No status",
                task.deadline || "No date"
            ]);
        });
    }

    if (sections.has("team")) {
        const teamMap = {};
        filteredTasks.forEach(task => {
            const user = task.assigned_to || "Unknown";
            if (!teamMap[user]) teamMap[user] = { total: 0, completed: 0 };
            teamMap[user].total++;
            if (normalizeReportStatus(task.status) === "done") teamMap[user].completed++;
        });

        rows.push(
            [],
            ["Team Performance"],
            ["Member", "Completed", "Total", "Completion"]
        );

        Object.keys(teamMap).forEach(user => {
            const total = teamMap[user].total;
            const teamCompleted = teamMap[user].completed;
            rows.push([user, teamCompleted, total, `${total ? Math.round((teamCompleted / total) * 100) : 0}%`]);
        });
    }

    if (sections.has("activity")) {
        const token = sessionStorage.getItem("token");
        try {
            const res = await fetch(`${BASE_URL}/activities`, {
                headers: { "Authorization": "Bearer " + token }
            });
            const logs = res.ok ? await res.json() : [];
            rows.push(
                [],
                ["Activity Log"],
                ["Timestamp", "User", "Action", "Details"]
            );
            (Array.isArray(logs) ? logs : []).forEach(log => {
                rows.push([
                    formatDateTime(log.timestamp),
                    log.user_email || "-",
                    log.action || "-",
                    [log.target, log.details].filter(Boolean).join(" - ") || "-"
                ]);
            });
        } catch (error) {
            console.error("Activity export failed", error);
        }
    }

    if (sections.has("comments")) {
        rows.push([], ["Comments & Updates"], ["No comment export data is available yet."]);
    }

    const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
    const extension = format === "excel" ? "xls" : format === "pdf" ? "pdf" : "csv";
    const mimeType = format === "excel"
        ? "application/vnd.ms-excel;charset=utf-8;"
        : format === "pdf"
            ? "application/pdf;charset=utf-8;"
            : "text/csv;charset=utf-8;";
    const rangeLabel = startDate || endDate
        ? `-${startDate || "start"}-to-${endDate || "end"}`
        : "";

    const filename = `taskflow-report${rangeLabel}`;

    if (format === "pdf") {

        exportRealPDF(rows, filename);

    } else if (format === "excel") {

        exportExcel(rows, filename);

    } else {

        const blob = new Blob([csv], { type: mimeType });

        const url = URL.createObjectURL(blob);

        const anchor = document.createElement("a");

        anchor.href = url;

        anchor.download = `${filename}.csv`;

        document.body.appendChild(anchor);

        anchor.click();

        anchor.remove();

        URL.revokeObjectURL(url);
    }

    closeExportModal();
}

function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildPrintableReportHtml(rows) {
    const safeRows = rows.map(row => row.map(value => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")));

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>TaskFlow Report</title>
    <style>
        body { font-family: Arial, sans-serif; color: #0b1538; padding: 28px; }
        h1 { margin: 0 0 18px; }
        table { width: 100%; border-collapse: collapse; margin-top: 14px; }
        td { border: 1px solid #d9e1ee; padding: 8px 10px; font-size: 13px; }
        tr:has(td:only-child) td { background: #eef4ff; font-weight: 700; }
    </style>
</head>
<body>
    <h1>TaskFlow Report</h1>
    <table>
        ${safeRows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join("")}</tr>`).join("")}
    </table>
</body>
</html>`;
}

async function loadFiles() {
    const token = sessionStorage.getItem("token");
    const tbody = document.getElementById("files-table-body");
    const footer = document.getElementById("files-footer-copy");
    const storageCopy = document.getElementById("storage-copy");
    const storagePercent = document.getElementById("storage-percent");
    const storageFill = document.getElementById("storage-meter-fill");

    const role = sessionStorage.getItem("role");

    if (role === "user") {
        document.getElementById("uploadBtn").style.display = "none";
    }

    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="empty-table">Loading files...</td></tr>`;

    try {
        if (!Array.isArray(assignableUsers) || !assignableUsers.length) {
            await loadAssignableUsers();
        }

        const res = await fetch(`${BASE_URL}/files`, {
            headers: { "Authorization": "Bearer " + token }
        });
        const files = await res.json();
        filesCache = Array.isArray(files) ? files : [];
        const totalBytes = filesCache.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
        const percent = Math.min(100, Math.round((totalBytes / (100 * 1024 * 1024 * 1024)) * 100));

        if (storageCopy) storageCopy.textContent = `${formatSize(totalBytes)} used of 100 GB`;
        if (storagePercent) storagePercent.textContent = `${percent}%`;
        if (storageFill) storageFill.style.width = `${Math.max(percent, 2)}%`;
        renderFiles();
    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="7" class="empty-table">Unable to load files</td></tr>`;
    }
}

function renderFiles() {
    const tbody = document.getElementById("files-table-body");
    const footer = document.getElementById("files-footer-copy");
    if (!tbody) return;

    let items = [...filesCache];

    updateCategoryCounts();

    if (filesTab === "my") {
        const email = (sessionStorage.getItem("email") || "").trim().toLowerCase();
        items = items.filter(file => String(file.owner_email || file.owner || "").trim().toLowerCase() === email);
    } else if (filesTab === "shared") {
        const email = (sessionStorage.getItem("email") || "").trim().toLowerCase();
        items = items.filter(file => {
            const sharedWith = Array.isArray(file.shared_with) ? file.shared_with : [];
            return sharedWith.some(value => String(value || "").trim().toLowerCase() === email);
        });
    }

    if (filesCategory !== "all") {
        items = items.filter(file => getFileCategory(file) === filesCategory);
    }

    if (filesSort === "name-desc") {
        items.sort((a, b) => String(b.name || "").localeCompare(String(a.name || "")));
    } else if (filesSort === "date-desc") {
        items.sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0));
    } else {
        items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / filesPageSize));
    filesPage = Math.min(filesPage, totalPages);
    const start = (filesPage - 1) * filesPageSize;
    const pageItems = items.slice(start, start + filesPageSize);

    if (footer) {
        const startItem = total === 0 ? 0 : start + 1;
        const endItem = Math.min(start + pageItems.length, total);
        footer.textContent = total
            ? `Showing ${startItem} to ${endItem} of ${total} files`
            : `Showing 0 files`;
    }

    if (!pageItems.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-table">No files uploaded yet</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    const role = sessionStorage.getItem("role");

    const header = document.getElementById("assigned-header");
    if (header) {
        header.style.display = role === "user" ? "none" : "";
    }
    const currentEmail = (sessionStorage.getItem("email") || "").trim().toLowerCase();
    pageItems.forEach(file => {
        const row = document.createElement("tr");
        const fileOwnerEmail = String(file.owner_email || "").trim().toLowerCase();
        const sharedWith = Array.isArray(file.shared_with) ? file.shared_with : [];
        const canDelete = role === "admin" || role === "manager" || fileOwnerEmail === currentEmail;
        const canDownload = role === "admin" || role === "manager" || fileOwnerEmail === currentEmail || sharedWith.some(value => String(value || "").trim().toLowerCase() === currentEmail);
        const canAssign = role === "admin" || role === "manager";
        const assignedTo = sharedWith;
        const assignedLabel = assignedTo.length ? `${assignedTo.length} user${assignedTo.length === 1 ? "" : "s"}` : "Unassigned";
        const actionButtons = [];

        if (canDownload) {
            actionButtons.push(`<button class="action-btn" type="button" onclick="downloadFile('${encodeURIComponent(file.name)}')"><i class="fas fa-download"></i></button>`);
        }
        if (canDelete) {
            actionButtons.push(`<button class="delete-btn" type="button" onclick="deleteFile('${encodeURIComponent(file.name)}')">Delete</button>`);
        }

        row.innerHTML = `
            <td><i class="far fa-star star-icon" onclick="toggleStar(this)"></i></td>
            <td>
                <span class="file-icon ${getFileIconClass(file)}">
                    <i class="${getFileIcon(file)}"></i>
                </span>
                ${shortenFileName(file.name)}
            </td>            
            <td>${file.owner_name || file.owner_email || sessionStorage.getItem("username") || "Unknown"}</td>

            ${role !== "user" ? `
            <td>
                 ${renderAssignedControl(file)}
            </td>
            ` : ""}
           
            <td>${file.size_label || formatSize(file.size)}</td>
            <td>${formatDateTime(file.uploaded_at)}</td>
            <td>${actionButtons.length ? actionButtons.join(" ") : `<span class="file-lock"><i class="fas fa-lock"></i></span>`}</td>
        `;
        tbody.appendChild(row);
    });

    updatePagination(totalPages);
}

function shortenFileName(name) {
    const base = name.split('.')[0]; // remove .pdf
    return base.length > 13 ? base.substring(0, 16) + "..." : base;
}

function updateCategoryCounts() {
    const counts = {
        all: filesCache.length,
        documents: 0,
        images: 0,
        videos: 0,
        archives: 0,
        others: 0
    };

    filesCache.forEach(file => {
        counts[getFileCategory(file)] += 1;
    });

    document.querySelectorAll("#category-list .category-item").forEach(item => {
        const category = item.dataset.category;
        const count = item.querySelector("strong");
        if (count) {
            count.textContent = String(counts[category] || 0);
        }
        item.classList.toggle("active", category === filesCategory);
        item.style.color = category === filesCategory ? "#159653" : "#41516a";
    });
}

function updatePagination(totalPages) {
    const pagination = document.getElementById("files-pagination");
    if (!pagination) return;

    const buttons = [];
    const addPageButton = (label, page, active = false, disabled = false) => {
        buttons.push(`
            <button type="button" class="page-btn${active ? " active" : ""}${disabled ? " dots" : ""}" ${disabled ? "disabled" : ""} ${page ? `data-page="${page}" onclick="setFilesPage(${page})"` : ""}>${label}</button>
        `);
    };

    pagination.innerHTML = "";
    addPageButton('<i class="fas fa-chevron-left"></i>', Math.max(1, filesPage - 1), false, filesPage <= 1);

    if (totalPages <= 5) {
        for (let page = 1; page <= totalPages; page++) {
            addPageButton(String(page), page, page === filesPage);
        }
    } else {
        const pages = new Set([1, totalPages, filesPage, filesPage - 1, filesPage + 1]);
        const ordered = Array.from(pages)
            .filter(page => page >= 1 && page <= totalPages)
            .sort((a, b) => a - b);

        let last = 0;
        ordered.forEach(page => {
            if (page - last > 1) {
                buttons.push('<button type="button" class="page-btn dots" disabled>...</button>');
            }
            addPageButton(String(page), page, page === filesPage);
            last = page;
        });
    }

    addPageButton('<i class="fas fa-chevron-right"></i>', Math.min(totalPages, filesPage + 1), false, filesPage >= totalPages);
    pagination.innerHTML = buttons.join("");
}

function setFilesTab(tab) {
    filesTab = tab;
    filesPage = 1;

    document.querySelectorAll(".files-tab").forEach(btn => btn.classList.remove("active"));
    const active = document.querySelector(`.files-tab[data-files-tab="${tab}"]`);
    if (active) active.classList.add("active");

    renderFiles();
}

function setFilesCategory(category) {
    filesCategory = category;
    filesPage = 1;

    const labelMap = {
        all: "All Files",
        documents: "Documents",
        images: "Images",
        videos: "Videos",
        archives: "Archives",
        others: "Others"
    };

    const label = labelMap[category] || category;
    const labelEl = document.getElementById("selected-category-label");
    if (labelEl) labelEl.textContent = label;

    closeCategoryDropdown();
    renderFiles();
}

function toggleCategoryDropdown() {
    const menu = document.getElementById("files-category-dropdown-menu");
    if (menu) menu.classList.toggle("hidden");
}

function closeCategoryDropdown() {
    const menu = document.getElementById("files-category-dropdown-menu");
    if (menu && !menu.classList.contains("hidden")) {
        menu.classList.add("hidden");
    }
}

function toggleStorageDropdown() {
    const menu = document.getElementById("storage-dropdown-menu");
    if (!menu) return;
    const categoryMenu = document.getElementById("files-category-dropdown-menu");
    if (categoryMenu && !categoryMenu.classList.contains("hidden")) {
        categoryMenu.classList.add("hidden");
    }
    menu.classList.toggle("hidden");
}

function closeStorageDropdown() {
    const menu = document.getElementById("storage-dropdown-menu");
    if (menu && !menu.classList.contains("hidden")) {
        menu.classList.add("hidden");
    }
}

window.addEventListener("load", () => {
    applyDashboardRoleVisibility();
});

window.addEventListener("click", function(event) {
    const target = event.target;

    const categoryMenu = document.getElementById("files-category-dropdown-menu");
    const categoryButton = document.querySelector(".category-dropdown-btn");
    if (categoryMenu && categoryButton && !categoryMenu.classList.contains("hidden") && !categoryMenu.contains(target) && !categoryButton.contains(target)) {
        categoryMenu.classList.add("hidden");
    }

    const storageMenu = document.getElementById("storage-dropdown-menu");
    const storageButton = document.querySelector(".storage-dropdown-btn");
    if (storageMenu && storageButton && !storageMenu.classList.contains("hidden") && !storageMenu.contains(target) && !storageButton.contains(target)) {
        storageMenu.classList.add("hidden");
    }

    const assignMenus = document.querySelectorAll(".inline-assign-menu");
    assignMenus.forEach(menu => {
        const key = menu.id?.replace(/^assign-menu-/, "");
        const button = key ? document.querySelector(`[data-assign-key="${key}"]`) : null;
        if (menu && !menu.classList.contains("hidden") && !menu.contains(target) && !button?.contains(target)) {
            menu.classList.add("hidden");
        }
    });
});

function toggleFilesSort() {
    document.getElementById("sortOptions").classList.toggle("show");
}

function setSort(sortType) {

    filesSort = sortType;

    const label = document.querySelector(".files-sort span");

    if (label) {
        label.textContent =
            sortType === "name-asc"
            ? "Sort by: Name (A-Z)"
            : sortType === "name-desc"
            ? "Sort by: Name (Z-A)"
            : "Sort by: Date (Newest)";
    }

    document.getElementById("sortOptions").classList.remove("show");

    renderFiles();
}

function setFilesLayout(layout) {
    filesLayout = layout;
    document.querySelectorAll(".files-icon-btn").forEach(btn => btn.classList.remove("active"));
    const buttons = Array.from(document.querySelectorAll(".files-icon-btn"));
    if (layout === "list" && buttons[0]) buttons[0].classList.add("active");
    if (layout === "grid" && buttons[1]) buttons[1].classList.add("active");
}

function setFilesPage(page) {
    filesPage = page;
    renderFiles();
}

function changeFilesPage(delta) {
    const totalPages = Math.max(1, Math.ceil(filesCache.length / filesPageSize));
    filesPage = Math.min(totalPages, Math.max(1, filesPage + delta));
    renderFiles();
}

function createFolder() {
    alert("Folder creation is not connected yet.");
}

async function assignFileToUser(filename, email) {
    const target = email === "__unassigned__" ? [] : [email];
    const res = await fetch(`${BASE_URL}/files/${encodeURIComponent(filename)}/share`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + sessionStorage.getItem("token")
        },
        body: JSON.stringify({ shared_with: target })
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.detail || data.message || "Could not assign file");
        return;
    }

    await loadFiles();
}

function renderAssignedControl(file) {
    const key = encodeURIComponent(file.name);
    const selected = Array.isArray(file.shared_with) ? file.shared_with : [];

    const assignedLabel = selected.length
        ? `${selected.length} user${selected.length === 1 ? "" : "s"}`
        : "Unassigned";

    return `
        <div class="inline-assign">
            <button class="assign-btn"
                data-assign-key="${key}"
                onclick="toggleInlineAssign('${key}', event)">
                ${assignedLabel}
                <i class="fas fa-chevron-down"></i>
            </button>

            <div id="assign-menu-${key}" class="inline-assign-menu hidden">
                
                <input class="inline-assign-search-input" type="text" placeholder="Search user..."
                    oninput="filterInlineAssign('${key}', this.value)">

                <div class="assign-list">
                    ${assignableUsers.map(user => `
                        <label class="assign-option">
                            <input type="checkbox"
                                value="${user.email}"
                                ${selected.includes(user.email) ? "checked" : ""}>
                            ${user.email}
                        </label>
                    `).join("")}
                </div>

                <div class="inline-assign-actions">
                    <button class="btn-blue" onclick="closeInlineAssign('${key}')">Cancel</button>
                    <button class="btn-blue" onclick="saveInlineAssign('${key}')">Save</button>
                </div>

            </div>
        </div>
    `;
}

async function loadAssignableUsers() {
    const token = sessionStorage.getItem("token");
    try {
        if (!Array.isArray(allUsersCache) || !allUsersCache.length) {
            const usersRes = await fetch(`${BASE_URL}/users`, {
                headers: { "Authorization": "Bearer " + token }
            });
            allUsersCache = await usersRes.json().catch(() => []);
        }

        const source = Array.isArray(allUsersCache) ? allUsersCache.slice() : [];

        if (!Array.isArray(source)) {
            assignableUsers = [];
            assignableUsersLoaded = true;
            return;
        }

        assignableUsers = source
            .map(user => ({
                ...user,
                email: String(user.email || "").trim(),
                username: String(user.username || user.name || user.email || "").trim(),
                role: String(user.role || "").toLowerCase()
            }))
            .filter(user => user.email && user.role === "user")
            .sort((a, b) => a.email.localeCompare(b.email));
    } catch {
        assignableUsers = Array.isArray(allUsersCache) ? allUsersCache.slice() : [];
    }
    assignableUsersLoaded = true;
}

function positionInlineAssignMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 260);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;

    menu.style.position = "fixed";
    menu.style.left = Math.min(rect.left, window.innerWidth - menuWidth - 12) + "px";
    menu.style.width = menuWidth + "px";
    menu.style.maxHeight = Math.max(220, Math.min(320, openUp ? spaceAbove : spaceBelow)) + "px";
    menu.style.top = openUp ? "" : (rect.bottom + 8) + "px";
    menu.style.bottom = openUp ? (window.innerHeight - rect.top + 8) + "px" : "";
}

function toggleInlineAssign(key) {
    const menu = document.getElementById(`assign-menu-${key}`);
    if (!menu) return;
    const button = document.querySelector(`[data-assign-key="${key}"]`);
    if (!button) return;

    const isOpen = !menu.classList.contains("hidden");

    document.querySelectorAll(".inline-assign-menu").forEach(m => {
        closeInlineAssign(m.id?.replace(/^assign-menu-/, ""));
    });

    if (!isOpen) {
        if (!menu.__originalParent) {
            menu.__originalParent = menu.parentNode;
            menu.__originalNextSibling = menu.nextSibling;
        }
        document.body.appendChild(menu);
        positionInlineAssignMenu(button, menu);
        menu.classList.remove("hidden");
        button.classList.add("open");
    }
}

function closeInlineAssign(key) {
    const menu = document.getElementById(`assign-menu-${key}`);
    if (!menu) return;

    menu.classList.add("hidden");
    menu.removeAttribute("style");

    const button = document.querySelector(`[data-assign-key="${key}"]`);
    if (button) button.classList.remove("open");

    if (menu.__originalParent) {
        const parent = menu.__originalParent;
        const nextSibling = menu.__originalNextSibling;
        if (parent && parent.insertBefore) {
            parent.insertBefore(menu, nextSibling);
        }
    }

    if (inlineAssignTarget === key) inlineAssignTarget = "";
}

function filterInlineAssign(key, value) {
    const menu = document.getElementById(`assign-menu-${key}`);
    if (!menu) return;
    const query = (value || "").trim().toLowerCase();
    menu.querySelectorAll(".assign-option").forEach(row => {
        row.style.display = !query || row.textContent.toLowerCase().includes(query) ? "" : "none";
    });
}

function syncInlineAssign(key) {
    const menu = document.getElementById(`assign-menu-${key}`);
    if (!menu) return;
    const selectedValues = Array.from(menu.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    inlineAssignState[key] = selectedValues;
}

async function saveInlineAssign(key) {
    const menu = document.getElementById(`assign-menu-${key}`);
    if (!menu) return;

    const selectedValues = Array.from(
        menu.querySelectorAll('input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    const filename = decodeURIComponent(key);

    const res = await fetch(`${BASE_URL}/files/${encodeURIComponent(filename)}/share`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + sessionStorage.getItem("token")
        },
        body: JSON.stringify({
            shared_with: selectedValues   // 🔥 MULTIPLE USERS
        })
    });

    if (res.ok) {
        closeInlineAssign(key);
        loadFiles();
    } else {
        alert("Error assigning users");
    }
}

function getFileCategory(file) {
    const ext = (file.extension || "").toLowerCase();
    if (["doc", "docx", "pdf", "txt", "rtf", "odt"].includes(ext)) return "documents";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "images";
    if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "videos";
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archives";
    return "others";
}

async function handleFileUpload(event) {
    const token = sessionStorage.getItem("token");
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;

    try {
        for (const file of selected) {
            const formData = new FormData();
            formData.append("file", file);
            await fetch(`${BASE_URL}/files/upload`, {
                method: "POST",
                headers: { "Authorization": "Bearer " + token },
                body: formData
            });
        }
        event.target.value = "";
        loadFiles();
    } catch (error) {
        console.error(error);
        alert("Upload failed");
    }
}

async function downloadFile(filename) {
    const token = sessionStorage.getItem("token");
    const decoded = decodeURIComponent(filename);

    try {
        const res = await fetch(`${BASE_URL}/files/download/${encodeURIComponent(decoded)}`, {
            headers: { "Authorization": "Bearer " + token }
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.detail || data.message || "Download failed");
        }

        const blob = await res.blob();
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = decoded;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error(error);
        alert(error.message || "Could not download file");
    }
}

async function exportRealPDF(rows, filename) {

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF("p", "mm", "a4");

    // Title
    doc.setFontSize(22);
    doc.text("TaskFlow Report", 70, 20);

    // Date
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);

    let currentY = 40;

    let headers = [];
    let body = [];

    rows.forEach((row) => {

        // Section title
        if (row.length === 1) {

            // Print previous table first
            if (headers.length && body.length) {

                doc.autoTable({
                    startY: currentY,
                    head: [headers],
                    body: body,
                    theme: "grid",
                    styles: {
                        fontSize: 8,
                        cellPadding: 3,
                        overflow: "linebreak"
                    },
                    headStyles: {
                        fillColor: [41, 128, 185]
                    }
                });

                currentY = doc.lastAutoTable.finalY + 10;

                headers = [];
                body = [];
            }

            // Section heading
            doc.setFontSize(14);
            doc.setTextColor(41, 128, 185);

            doc.text(String(row[0]), 14, currentY);

            currentY += 8;
        }

        // Header row
        else if (!headers.length) {

            headers = row;

        }

        // Table body
        else {

            body.push(row);
        }

    });

    // Final table
    if (headers.length && body.length) {

        doc.autoTable({
            startY: currentY,
            head: [headers],
            body: body,
            theme: "grid",
            styles: {
                fontSize: 8,
                cellPadding: 3,
                overflow: "linebreak"
            },
            headStyles: {
                fillColor: [41, 128, 185]
            }
        });

    }

    const pdfBlob = doc.output("blob");

    const handle = await window.showSaveFilePicker({

        suggestedName: filename + ".pdf",

        types: [
            {
                description: "PDF File",
                accept: {
                    "application/pdf": [".pdf"]
                }
            }
        ]
    });

    const writable = await handle.createWritable();

    await writable.write(pdfBlob);

    await writable.close();
}

async function exportExcel(rows, filename) {

    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    worksheet["!cols"] = [
        { wch: 40 },
        { wch: 30 },
        { wch: 30 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 }
    ];

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");

    const excelBuffer = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array"
    });

    const blob = new Blob(
        [excelBuffer],
        {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
    );

    const handle = await window.showSaveFilePicker({

        suggestedName: filename + ".xlsx",

        types: [
            {
                description: "Excel File",
                accept: {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
                }
            }
        ]
    });

    const writable = await handle.createWritable();

    await writable.write(blob);

    await writable.close();
}

async function deleteFile(filename) {
    const token = sessionStorage.getItem("token");
    const decoded = decodeURIComponent(filename);
    if (!confirm(`Delete ${decoded}?`)) return;

    const res = await fetch(`${BASE_URL}/files/${encodeURIComponent(decoded)}`, {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + token }
    });

    if (res.ok) {
        loadFiles();
    } else {
        alert("Could not delete file");
    }
}

function getFileIconClass(file) {
    const ext = (file.extension || "").toLowerCase();
    if (ext === "pdf") return "pdf";
    if (ext === "doc" || ext === "docx") return "doc";
    if (ext === "xls" || ext === "xlsx") return "xls";
    if (ext === "ppt" || ext === "pptx") return "ppt";
    if (["png", "jpg", "jpeg", "gif"].includes(ext)) return "img";
    if (["zip", "rar", "7z"].includes(ext)) return "zip";
    return "folder";
}

function getFileIcon(file) {
    const map = {
        pdf: "fas fa-file-pdf",
        doc: "fas fa-file-word",
        xls: "fas fa-file-excel",
        ppt: "fas fa-file-powerpoint",
        img: "fas fa-image",
        zip: "fas fa-file-zipper",
        folder: "fas fa-folder"
    };
    return map[getFileIconClass(file)] || "fas fa-file";
}

function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);

    return date.toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

async function initializeDashboardPage() {
    if (typeof applySettingsPreferences === "function") {
        applySettingsPreferences();
    }

    applyDashboardRoleVisibility();

    let defaultView = sessionStorage.getItem("settings.defaultView") || "dashboard";
    if (defaultView === "activity-log" && sessionStorage.getItem("role") === "user") {
        defaultView = "files";
    }
    setProjectTab(defaultView);

    if (typeof loadAssignableUsers === "function") {
        await loadAssignableUsers();
    }
}

window.addEventListener("load", initializeDashboardPage);
window.addEventListener("load", loadDashboardSummary);
window.addEventListener("load", applySettingsPreferences);

function toggleNotifications(event) {

    event.stopPropagation();

    const dropdown = document.getElementById("notification-dropdown");

    dropdown.classList.toggle("show");
}

document.addEventListener("click", function () {

    document
    .getElementById("notification-dropdown")
    .classList.remove("show");
});

async function loadNotifications() {

    const token = sessionStorage.getItem("token");

    await fetch(`${BASE_URL}/notifications/cleanup`, {
        method: "DELETE"
    });

    try {

        const res = await fetch(`${BASE_URL}/notifications`, {

            headers: {
                "Authorization": "Bearer " + token
            }
        });

        const notifications = await res.json();
        allNotifications = notifications;
        renderNotifications();
        return;

        const list =
            document.getElementById("notification-list");

        const count =
            document.getElementById("notification-count");

        if (!list) return;

        list.innerHTML = "";

        const unreadCount =
            notifications.filter(n => !n.read).length;

        if (unreadCount > 0) {

            count.style.display = "flex";

            count.innerText = unreadCount;

        } else {

            count.style.display = "none";
        }

        if (notifications.length === 0) {

            list.innerHTML = `
                <div class="notification-empty">
                    No notifications
                </div>
            `;

            return;
        }

        notifications.forEach(notification => {

            list.innerHTML += `
            
            <div class="notification-item ${notification.read ? "" : "unread"}">

                <div class="notification-icon blue">
                    <i class="fas fa-tasks"></i>
                </div>

                <div class="notification-content">

                    <h4>${notification.title}</h4>

                    <p>${notification.message}</p>

                    <small>${notification.time}</small>

                </div>

            </div>
            `;
        });

    } catch(error) {

        console.log(error);
    }
}

window.addEventListener("load", loadNotifications);

setInterval(loadNotifications, 5000);

function renderNotifications() {

    const list =
        document.getElementById("notification-list");

    const count =
        document.getElementById("notification-count");

    if (!list) return;

    const unreadCount =
        allNotifications.filter(n => !n.read).length;

    if (unreadCount > 0) {

        count.style.display = "flex";

        count.innerText = unreadCount;

    } else {

        count.style.display = "none";
    }

    list.innerHTML = "";

    let filtered = allNotifications;

    if (currentFilter === "unread") {

        filtered = allNotifications.filter(n => !n.read);
    }

    if (currentFilter === "mentions") {

        filtered = allNotifications.filter(n =>
            n.message?.includes("@")
        );
    }

    if (filtered.length === 0) {

        list.innerHTML = `
            <div class="notification-empty">
                No notifications
            </div>
        `;

        return;
    }

    filtered.forEach(notification => {

        list.innerHTML += `
        
        <div class="notification-item ${notification.read ? "" : "unread"}"
                onclick="markNotificationRead('${notification.id}')">

            <div class="notification-icon blue">
                <i class="fas fa-tasks"></i>
            </div>

            <div class="notification-content">

                <h4>${notification.title}</h4>

                <p>${notification.message}</p>

                <small>
                    ${formatNotificationTime(notification.time)}
                </small>

            </div>

        </div>
        `;
    });
}

function setNotificationFilter(filter, event) {

    event.stopPropagation();

    currentFilter = filter;

    document
        .querySelectorAll(".notification-tabs button")
        .forEach(btn =>
            btn.classList.remove("active-tab")
        );

    event.target.classList.add("active-tab");

    renderNotifications();
}

async function markNotificationRead(id) {

    const token = sessionStorage.getItem("token");

    try {

        const response = await fetch(

            `${BASE_URL}/notifications/${id}/read`,

            {
                method: "PUT",

                headers: {
                    "Authorization": "Bearer " + token
                }
            }
        );

        if (!response.ok) {

            throw new Error("Failed");
        }

        allNotifications = allNotifications.map(notification => {

            if (
                notification._id === id ||
                notification.id === id
            ) {

                notification.read = true;
            }

            return notification;
        });

        renderNotifications();

    } catch(error) {

        console.log(error);
    }
}

async function markAllNotificationsRead(event) {

    event.stopPropagation();

    const token = sessionStorage.getItem("token");

    try {

        const response = await fetch(

            `${BASE_URL}/notifications/read-all`,

            {
                method: "PUT",

                headers: {
                    "Authorization": "Bearer " + token
                }
            }
        );

        const data = await response.json();

        console.log(data);

        if (!response.ok) {

            throw new Error("Failed");
        }

        allNotifications = allNotifications.map(notification => ({

            ...notification,

            read: true
        }));

        renderNotifications();

    } catch(error) {

        console.log(error);
    }
}

function formatNotificationTime(timeString) {

    const date = new Date(timeString);

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
