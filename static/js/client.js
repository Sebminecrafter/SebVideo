function $(id) {
  return document.getElementById(id);
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

function themeRefresh() {
  let theme = getCookie("theme") || "light";
  document.body.className = theme;
  $("toggletheme").textContent = theme == "light" ? "☀︎" : "☾";
}

function toggleTheme() {
  let theme = getCookie("theme") || "light";
  theme = theme == "light" ? "dark" : "light";
  document.cookie = "theme=" + theme;
  themeRefresh();
}

function getBase64(file) {
  var reader = new FileReader();
  reader.readAsDataURL(file);
  return new Promise((resolve, reject) => {
    reader.onloadend = function () {
      resolve(reader.result);
    };
    reader.onerror = function (error) {
      reject("Error: ", error);
    };
  });
}

function uploadVideo(
  name,
  description,
  token,
  file,
  apiUrl = "/api/upload",
  onProgress,
) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl);

    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.setRequestHeader("X-Video-Name", encodeURIComponent(name));
    xhr.setRequestHeader(
      "X-Video-Description",
      encodeURIComponent(description),
    );

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const progress = ((e.loaded / e.total) * 100).toFixed(1);
        console.log(`Upload progress: ${progress}%`);
        if (onProgress) onProgress(progress);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));

    xhr.send(file);
  });
}

function uploadThumbnail(videoId, token, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload-thumbnail");

    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "image/jpeg");
    xhr.setRequestHeader("X-Video-Id", videoId);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const progress = ((e.loaded / e.total) * 100).toFixed(1);
        console.log(`Thumbnail upload progress: ${progress}%`);
        if (onProgress) onProgress(progress);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));

    xhr.send(file);
  });
}

function uploadPage() {
  const nameInput = $("name");
  const descriptionInput = $("description");
  const tokenInput = $("token");
  const videoInput = $("video");
  const videoLabel = $("videolabel");
  const thumbnailInput = $("thumbnail");
  const thumbnailLabel = $("thumbnaillabel");
  const submitBtn = $("submitBtn");
  const videoObj = $("videoobj");
  const progressContainer = $("progressContainer");
  const progressLabel = $("progressLabel");
  const progressFill = $("progressFill");
  const progressPercent = $("progressPercent");
  const notificationOverlay = $("notificationOverlay");
  const notificationContent = $("notificationContent");
  const notificationClose = $("notificationClose");

  function showNotification(html) {
    notificationContent.innerHTML = html;
    notificationOverlay.style.display = "flex";
  }

  function closeNotification() {
    notificationOverlay.style.display = "none";
  }

  notificationClose.addEventListener("click", closeNotification);
  notificationOverlay.addEventListener("click", (e) => {
    if (e.target === notificationOverlay) closeNotification();
  });

  videoInput.addEventListener("change", async () => {
    if (videoInput.files.length === 0) {
      videoLabel.textContent = "Choose a video.";
      return;
    }

    const file = videoInput.files[0];

    if (!file.type.startsWith("video/")) {
      videoLabel.textContent = "Please select a video file.";
      videoInput.value = "";
      return;
    }

    videoLabel.textContent = "";
    getBase64(file).then((response) => {
      videoObj.src = response;
    });
  });

  thumbnailInput.addEventListener("change", async () => {
    if (thumbnailInput.files.length === 0) return;

    const file = thumbnailInput.files[0];

    if (!file.type.startsWith("image/")) {
      thumbnailLabel.textContent = "Please select an image file.";
      thumbnailInput.value = "";
      return;
    }

    thumbnailLabel.textContent = "";
    getBase64(file).then((response) => {
      videoObj.poster = response;
    });
  });

  submitBtn.addEventListener("click", async () => {
    const name = nameInput.value;
    const description = descriptionInput.value;
    const token = tokenInput.value;
    const file = videoInput.files[0];
    const thumbnailFile = thumbnailInput.files[0];

    if (!file) {
      videoLabel.textContent = "Choose a video.";
      return;
    }

    if (!name) {
      showNotification("<p>Please enter a video name</p>");
      return;
    }

    if (!token) {
      showNotification("<p>Please enter token</p>");
      return;
    }

    try {
      submitBtn.disabled = true;
      progressContainer.style.display = "block";
      progressFill.style.width = "0%";
      progressPercent.textContent = "0%";
      progressLabel.textContent = "Uploading video...";

      const uploadResult = await uploadVideo(
        name,
        description,
        token,
        file,
        "/api/upload",
        (progress) => {
          progressFill.style.width = progress + "%";
          progressPercent.textContent = Math.floor(progress) + "%";
        },
      );
      console.log("Video upload response:", uploadResult);

      let successHtml = `<p>Video uploaded successfully!</p>
        <p><a href="/watch?v=${uploadResult.id}">View your video</a></p>
        <p style="font-size: 0.9em; opacity: 0.8;">Note: Your video may still be processing. Check back in a few moments if it's not playable yet.</p>`;

      if (thumbnailFile) {
        try {
          progressLabel.textContent = "Uploading thumbnail...";
          progressFill.style.width = "0%";
          progressPercent.textContent = "0%";

          const thumbnailResult = await uploadThumbnail(
            uploadResult.id,
            token,
            thumbnailFile,
            (progress) => {
              progressFill.style.width = progress + "%";
              progressPercent.textContent = Math.floor(progress) + "%";
            },
          );
          console.log("Thumbnail upload response:", thumbnailResult);
          successHtml = `<p>Video and thumbnail uploaded successfully!</p>
            <p><a href="/watch?v=${uploadResult.id}">View your video</a></p>
            <p style="font-size: 0.9em; opacity: 0.8;">Note: Your video may still be processing. Check back in a few moments if it's not playable yet.</p>`;
        } catch (e) {
          console.error("Thumbnail upload failed:", e);
          successHtml = `<p>Video uploaded successfully, but thumbnail upload failed.</p>
            <p><a href="/watch?v=${uploadResult.id}">View your video</a></p>
            <p style="font-size: 0.9em; opacity: 0.8; color: #ff9800;">Error: ${e.message}</p>
            <p style="font-size: 0.9em; opacity: 0.8;">Note: Your video may still be processing. Check back in a few moments if it's not playable yet.</p>`;
        }
      }

      showNotification(successHtml);

      nameInput.value = "";
      descriptionInput.value = "";
      videoInput.value = "";
      thumbnailInput.value = "";
      videoObj.src = "";
      videoObj.poster = "";
      videoLabel.textContent = "Choose a video.";
      thumbnailLabel.textContent = "Choose a thumbnail (optional).";
    } catch (e) {
      console.error("Upload failed:", e);
      showNotification(`<p>Upload failed: ${e.message}</p>`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload";
      progressContainer.style.display = "none";
    }
  });
}

addEventListener("DOMContentLoaded", (event) => {
  themeRefresh();
  $("toggletheme").addEventListener("click", (event) => {
    toggleTheme();
  });
});
