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
  $("toggletheme").textContent = theme == "light" ? "☀︎" : "⏾";
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

function uploadVideo(name, description, token, file, apiUrl = "/api/upload") {
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
        console.log(
          `Upload progress: ${((e.loaded / e.total) * 100).toFixed(1)}%`,
        );
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

function uploadThumbnail(videoId, token, file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload-thumbnail");

    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "image/jpeg");
    xhr.setRequestHeader("X-Video-Id", videoId);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        console.log(
          `Thumbnail upload progress: ${((e.loaded / e.total) * 100).toFixed(1)}%`,
        );
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
  const thumbnailObj = $("thumbnailobj");

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
    if (thumbnailInput.files.length === 0) {
      thumbnailObj.style.display = "none";
      return;
    }

    const file = thumbnailInput.files[0];

    if (!file.type.startsWith("image/")) {
      thumbnailLabel.textContent = "Please select an image file.";
      thumbnailInput.value = "";
      thumbnailObj.style.display = "none";
      return;
    }

    thumbnailLabel.textContent = "";
    getBase64(file).then((response) => {
      thumbnailObj.src = response;
      thumbnailObj.style.display = "block";
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
      alert("Please enter a video name");
      return;
    }

    if (!token) {
      alert("Please enter token");
      return;
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "Uploading...";

      const uploadResult = await uploadVideo(name, description, token, file);
      console.log("Video upload response:", uploadResult);
      alert(`Video uploaded! ID: ${uploadResult.id}`);

      if (thumbnailFile) {
        try {
          const thumbnailResult = await uploadThumbnail(uploadResult.id, token, thumbnailFile);
          console.log("Thumbnail upload response:", thumbnailResult);
          alert("Thumbnail uploaded!");
        } catch (e) {
          console.error("Thumbnail upload failed:", e);
          alert("Video uploaded but thumbnail failed: " + e.message);
        }
      }

      nameInput.value = "";
      descriptionInput.value = "";
      videoInput.value = "";
      thumbnailInput.value = "";
      videoObj.src = "";
      thumbnailObj.src = "";
      thumbnailObj.style.display = "none";
      videoLabel.textContent = "Choose a video.";
      thumbnailLabel.textContent = "Choose a thumbnail (optional).";
    } catch (e) {
      console.error("Upload failed:", e);
      alert("Upload failed: " + e.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload";
    }
  });
}

addEventListener("DOMContentLoaded", (event) => {
  themeRefresh();
  $("toggletheme").addEventListener("click", (event) => {
    toggleTheme();
  });
});
