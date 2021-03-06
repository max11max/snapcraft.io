import { RISKS } from "./constants";

// getting list of tracks names from channel maps list
function getTracksFromChannelMap(channelMapsList) {
  const tracks = ["latest"];

  channelMapsList.map(t => t.track).forEach(track => {
    // if we haven't saved it yet
    if (tracks.indexOf(track) === -1) {
      tracks.push(track);
    }
  });

  return tracks;
}

function getRevisionsMap(revisions) {
  const revisionsMap = {};
  revisions.forEach(rev => {
    rev.channels = [];
    revisionsMap[rev.revision] = rev;
  });

  return revisionsMap;
}

// init channels data in revision history
function initReleasesData(revisionsMap, releases) {
  // go through releases from older to newest
  releases
    .slice()
    .reverse()
    .forEach(release => {
      if (release.revision && !release.branch) {
        const rev = revisionsMap[release.revision];

        if (rev) {
          const channel =
            release.track === "latest"
              ? release.risk
              : `${release.track}/${release.risk}`;

          if (rev.channels.indexOf(channel) === -1) {
            rev.channels.push(channel);
          }
        }
      }
    });

  return releases;
}

// transforming channel map list data into format used by this component
function getReleaseDataFromChannelMap(channelMapsList, revisionsMap) {
  const releasedChannels = {};
  const releasedArchs = {};

  channelMapsList.forEach(mapInfo => {
    const { track, architecture, map } = mapInfo;
    map.forEach(channelInfo => {
      if (channelInfo.info === "released") {
        const channel =
          track === "latest"
            ? `${track}/${channelInfo.channel}`
            : channelInfo.channel;

        if (!releasedChannels[channel]) {
          releasedChannels[channel] = {};
        }

        // XXX bartaz
        // this may possibly lead to issues with revisions in multiple architectures
        // if we have data about given revision in revision history we can store it
        if (revisionsMap[channelInfo.revision]) {
          releasedChannels[channel][architecture] =
            revisionsMap[channelInfo.revision];
          // but if for some reason we don't have full data about revision in channel map
          // we need to ducktype it from channel info
        } else {
          releasedChannels[channel][architecture] = channelInfo;
          releasedChannels[channel][architecture].architectures = [
            architecture
          ];
        }

        releasedArchs[architecture] = true;
      }
    });
  });

  return releasedChannels;
}

// update list of architectures based on revisions released (or selected)
function getArchsFromReleasedChannels(releasedChannels) {
  let archs = [];
  Object.keys(releasedChannels).forEach(channel => {
    Object.keys(releasedChannels[channel]).forEach(arch => {
      archs.push(arch);
    });
  });

  // make archs unique and sorted
  archs = archs.filter((item, i, ar) => ar.indexOf(item) === i);

  return archs.sort();
}

function getFilteredReleaseHistory(releases, revisionsMap, filters) {
  return (
    releases
      // only releases of revisions (ignore closing channels)
      .filter(release => release.revision)
      // only releases in given architecture
      .filter(release => {
        return filters && filters.arch
          ? release.architecture === filters.arch
          : true;
      })
      // only releases in given track
      .filter(release => {
        return filters && filters.track
          ? release.track === filters.track
          : true;
      })
      // only releases in given risk
      .filter(release => {
        return filters && filters.risk ? release.risk === filters.risk : true;
      })
      // before we have branches support we ignore any releases to branches
      .filter(release => !release.branch)
      // only one latest release of every revision
      .filter((release, index, all) => {
        return all.findIndex(r => r.revision === release.revision) === index;
      })
      // map release history to revisions
      .map(release => {
        const revision = JSON.parse(
          JSON.stringify(revisionsMap[release.revision])
        );
        revision.release = release;
        return revision;
      })
  );
}

// for channel without release get next (less risk) channel with a release
function getTrackingChannel(releasedChannels, track, risk, arch) {
  let tracking = null;
  // if there is no revision for this arch in given channel (track/risk)
  if (
    !(
      releasedChannels[`${track}/${risk}`] &&
      releasedChannels[`${track}/${risk}`][arch]
    )
  ) {
    // find the next channel that has any revision
    for (let i = RISKS.indexOf(risk); i >= 0; i--) {
      const trackingChannel = `${track}/${RISKS[i]}`;

      if (
        releasedChannels[trackingChannel] &&
        releasedChannels[trackingChannel][arch]
      ) {
        tracking = trackingChannel;
        break;
      }
    }
  }

  return tracking;
}

export {
  getArchsFromReleasedChannels,
  getFilteredReleaseHistory,
  getTracksFromChannelMap,
  getTrackingChannel,
  getRevisionsMap,
  initReleasesData,
  getReleaseDataFromChannelMap
};
