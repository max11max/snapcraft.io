import React, { Component, Fragment } from "react";
import PropTypes from "prop-types";
import "whatwg-fetch";

import ReleasesTable from "./releasesTable";
import Notification from "./notification";
import { isInDevmode } from "./devmodeIcon";
import { UNASSIGNED } from "./constants";

import {
  getArchsFromReleasedChannels,
  getTracksFromChannelMap,
  getRevisionsMap,
  initReleasesData,
  getReleaseDataFromChannelMap
} from "./releasesState";

export default class ReleasesController extends Component {
  constructor(props) {
    super(props);

    // init channel data in revisions list
    const revisionsMap = getRevisionsMap(this.props.releasesData.revisions);
    initReleasesData(revisionsMap, this.props.releasesData.releases);

    const releasedChannels = getReleaseDataFromChannelMap(
      this.props.channelMapsList,
      revisionsMap
    );

    const tracks = getTracksFromChannelMap(this.props.channelMapsList);

    this.state = {
      // default to latest track
      currentTrack: this.props.options.defaultTrack || "latest",
      error: null,
      isLoading: false,
      // released channels contains channel map for each channel in current track
      // also includes 'unassigned' fake channel to show selected unassigned revision
      releasedChannels: releasedChannels,
      // list of releases returned by API
      releases: this.props.releasesData.releases,
      // map of revisions (with revisionId as a key)
      revisionsMap: revisionsMap,
      // list of all available tracks
      tracks: tracks,
      // list of architectures released to (or selected to be released to)
      archs: getArchsFromReleasedChannels(releasedChannels),
      // revisions to be released:
      // key is the id of revision to release
      // value is object containing release object and channels to release to
      // {
      //  <revisionId>: {
      //    revision: { revision: <revisionId>, version, ... },
      //    channels: [ ... ]
      //  }
      // }
      pendingReleases: {},
      pendingCloses: [],
      // list of selected revisions, to know which ones to render selected
      selectedRevisions: [],
      // filters for revisions list
      // {
      //   arch: 'architecture'
      // }
      revisionsFilters: null,
      isHistoryOpen: false
    };
  }

  updateReleasesData(releasesData) {
    // init channel data in revisions list
    const revisionsMap = getRevisionsMap(releasesData.revisions);
    initReleasesData(revisionsMap, releasesData.releases);

    this.setState({
      revisionsMap,
      releases: releasesData.releases
    });
  }

  selectRevision(revision) {
    this.setState(state => {
      const releasedChannels = state.releasedChannels;

      // TODO: support multiple archs
      const arch = revision.architectures[0];

      if (!releasedChannels[UNASSIGNED]) {
        releasedChannels[UNASSIGNED] = {};
      }

      if (
        releasedChannels[UNASSIGNED][arch] &&
        releasedChannels[UNASSIGNED][arch].revision === revision.revision
      ) {
        delete releasedChannels[UNASSIGNED][arch];
      } else {
        releasedChannels[UNASSIGNED][arch] = revision;
      }

      const selectedRevisions = Object.keys(releasedChannels[UNASSIGNED]).map(
        arch => releasedChannels[UNASSIGNED][arch].revision
      );
      const archs = getArchsFromReleasedChannels(releasedChannels);

      return {
        selectedRevisions,
        releasedChannels,
        archs
      };
    });
  }

  setCurrentTrack(track) {
    this.setState({ currentTrack: track });
  }

  // get channel map data updated with any pending releases
  getNextReleasedChannels() {
    const nextReleaseData = JSON.parse(
      JSON.stringify(this.state.releasedChannels)
    );
    const { pendingReleases } = this.state;

    // for each release
    Object.keys(pendingReleases).forEach(releasedRevision => {
      pendingReleases[releasedRevision].channels.forEach(channel => {
        const revision = pendingReleases[releasedRevision].revision;

        if (!nextReleaseData[channel]) {
          nextReleaseData[channel] = {};
        }

        revision.architectures.forEach(arch => {
          nextReleaseData[channel][arch] = revision;
        });
      });
    });

    return nextReleaseData;
  }

  promoteChannel(channel, targetChannel) {
    const releasedChannels = this.getNextReleasedChannels();
    const archRevisions = releasedChannels[channel];

    if (archRevisions) {
      Object.keys(archRevisions).forEach(arch => {
        this.promoteRevision(archRevisions[arch], targetChannel);
      });
    }
  }

  closeChannel(channel) {
    this.setState(state => {
      let { pendingCloses, pendingReleases } = state;

      pendingCloses.push(channel);
      // make sure channels are unique
      pendingCloses = pendingCloses.filter(
        (item, i, ar) => ar.indexOf(item) === i
      );

      // undo any pending releases to closed channel
      Object.keys(pendingReleases).forEach(revision => {
        const channels = pendingReleases[revision].channels;

        if (channels.includes(channel)) {
          channels.splice(channels.indexOf(channel), 1);
        }

        if (channels.length === 0) {
          delete pendingReleases[revision];
        }
      });

      return {
        pendingCloses,
        pendingReleases
      };
    });
  }

  // TODO:
  // - ignore if revision is already in given channel
  promoteRevision(revision, channel) {
    this.setState(state => {
      const { pendingReleases, releasedChannels } = state;

      // compare given revision with released revisions in this arch and channel
      const isAlreadyReleased = revision.architectures.every(arch => {
        const releasedRevision =
          releasedChannels[channel] && releasedChannels[channel][arch];

        return (
          releasedRevision && releasedRevision.revision === revision.revision
        );
      });

      if (!isAlreadyReleased) {
        // cancel any other pending release for the same channel in same architectures
        revision.architectures.forEach(arch => {
          Object.keys(pendingReleases).forEach(revisionId => {
            const pendingRelease = pendingReleases[revisionId];

            if (
              pendingRelease.channels.includes(channel) &&
              pendingRelease.revision.architectures.includes(arch)
            ) {
              this.undoRelease(pendingRelease.revision, channel);
            }
          });
        });

        if (!pendingReleases[revision.revision]) {
          pendingReleases[revision.revision] = {
            revision: revision,
            channels: []
          };
        }

        let channels = pendingReleases[revision.revision].channels;
        channels.push(channel);

        // make sure channels are unique
        channels = channels.filter((item, i, ar) => ar.indexOf(item) === i);

        pendingReleases[revision.revision].channels = channels;
      }

      return {
        error: null,
        pendingReleases
      };
    });
  }

  undoRelease(revision, channel) {
    this.setState(state => {
      const { pendingReleases } = state;

      if (pendingReleases[revision.revision]) {
        const channels = pendingReleases[revision.revision].channels;

        if (channels.includes(channel)) {
          channels.splice(channels.indexOf(channel), 1);
        }

        if (channels.length === 0) {
          delete pendingReleases[revision.revision];
        }
      }

      return {
        pendingReleases
      };
    });
  }

  clearPendingReleases() {
    this.setState({
      pendingReleases: {},
      pendingCloses: []
    });
  }

  fetchReleasesHistory() {
    const { csrfToken } = this.props.options;

    return fetch(`/${this.props.snapName}/releases/json`, {
      method: "GET",
      mode: "cors",
      cache: "no-cache",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-CSRFToken": csrfToken
      },
      redirect: "follow",
      referrer: "no-referrer"
    }).then(response => response.json());
  }

  fetchRelease(revision, channels) {
    const { csrfToken } = this.props.options;

    return fetch(`/${this.props.snapName}/releases`, {
      method: "POST",
      mode: "cors",
      cache: "no-cache",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-CSRFToken": csrfToken
      },
      redirect: "follow",
      referrer: "no-referrer",
      body: JSON.stringify({ revision, channels, name: this.props.snapName })
    }).then(response => response.json());
  }

  fetchClose(channels) {
    const { csrfToken } = this.props.options;

    return fetch(`/${this.props.snapName}/releases/close-channel`, {
      method: "POST",
      mode: "cors",
      cache: "no-cache",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-CSRFToken": csrfToken
      },
      redirect: "follow",
      referrer: "no-referrer",
      body: JSON.stringify({ channels })
    }).then(response => response.json());
  }

  // TODO: move inside of this function out
  handleReleaseResponse(json, release) {
    if (json.success) {
      this.setState(state => {
        const releasedChannels = state.releasedChannels;

        // update releasedChannels based on channel map from the response
        json.channel_map.forEach(map => {
          if (map.revision) {
            let revision;

            if (map.revision === +release.id) {
              // release.id is a string so turn it into a number for comparison
              revision = release.revision;
            } else if (this.state.revisionsMap[map.revision]) {
              revision = this.state.revisionsMap[map.revision];
            } else {
              revision = {
                revision: map.revision,
                version: map.version,
                architectures: release.revision.architectures
              };
            }

            let channel = map.channel;
            if (channel.indexOf("/") === -1) {
              channel = `latest/${channel}`;
            }

            if (!releasedChannels[channel]) {
              releasedChannels[channel] = {};
            }

            revision.architectures.forEach(arch => {
              const currentlyReleased = releasedChannels[channel][arch];

              // only update revision in channel map if it changed since last time
              if (
                !currentlyReleased ||
                currentlyReleased.revision !== revision.revision
              ) {
                releasedChannels[channel][arch] = revision;
              }
            });
          }
        });

        const archs = getArchsFromReleasedChannels(releasedChannels);

        return {
          releasedChannels,
          archs
        };
      });
    } else {
      let error = new Error(
        `Error while releasing ${release.revision.version} (${
          release.revision.revision
        }) to ${release.channels.join(", ")}.`
      );
      error.json = json;
      throw error;
    }
  }

  handleReleaseError(error) {
    let message =
      error.message ||
      "Error while performing the release. Please try again later.";

    // try to find error messages in response json
    // which may be an array or errors or object with errors property
    if (error.json) {
      const errors = error.json.length ? error.json : error.json.errors;

      if (errors.length) {
        message =
          message +
          " " +
          errors
            .map(e => e.message)
            .filter(m => m)
            .join(" ");
      }
    }

    this.setState({
      error: message
    });
  }

  handleCloseResponse(json, channels) {
    if (json.success) {
      this.setState(state => {
        const { releasedChannels } = state;

        if (json.closed_channels && json.closed_channels.length > 0) {
          json.closed_channels.forEach(channel => {
            // make sure default channels get prefixed with 'latest'
            if (channel.indexOf("/") === -1) {
              channel = `latest/${channel}`;
            }

            delete releasedChannels[channel];
          });
        }

        return {
          releasedChannels
        };
      });
    } else {
      let error = new Error(
        `Error while closing channels: ${channels.join(", ")}.`
      );
      error.json = json;
      throw error;
    }
  }

  fetchReleases(releases) {
    var queue = Promise.resolve(); // Q() in q

    // handle releases as a queue
    releases.forEach(release => {
      return (queue = queue.then(() => {
        return this.fetchRelease(release.id, release.channels).then(json =>
          this.handleReleaseResponse(json, release)
        );
      }));
    });
    return queue;
  }

  fetchCloses(channels) {
    if (channels.length) {
      return this.fetchClose(channels).then(json =>
        this.handleCloseResponse(json, channels)
      );
    } else {
      return Promise.resolve();
    }
  }

  fetchUpdatedReleasesHistory() {
    return this.fetchReleasesHistory().then(json =>
      this.updateReleasesData(json)
    );
  }

  releaseRevisions() {
    const { pendingReleases, pendingCloses } = this.state;
    const releases = Object.keys(pendingReleases).map(id => {
      return {
        id,
        revision: pendingReleases[id].revision,
        channels: pendingReleases[id].channels
      };
    });

    this.setState({ isLoading: true });
    this.fetchReleases(releases)
      .then(() => this.fetchCloses(pendingCloses))
      .then(() => this.fetchUpdatedReleasesHistory())
      .catch(error => this.handleReleaseError(error))
      .then(() => this.setState({ isLoading: false }))
      .then(() => this.clearPendingReleases());
  }

  toggleHistoryPanel(filters) {
    const currentFilters = this.state.revisionsFilters;
    const isHistoryOpen = this.state.isHistoryOpen;

    if (
      isHistoryOpen &&
      (filters == currentFilters ||
        (filters &&
          currentFilters &&
          filters.track === currentFilters.track &&
          filters.arch === currentFilters.arch &&
          filters.risk === currentFilters.risk))
    ) {
      this.closeHistoryPanel();
    } else {
      this.openHistoryPanel(filters);
    }
  }

  openHistoryPanel(filters) {
    this.setState({
      revisionsFilters: filters,
      isHistoryOpen: true
    });
  }

  closeHistoryPanel() {
    this.setState({
      revisionsFilters: null,
      isHistoryOpen: false
    });
  }

  render() {
    const hasDevmodeRevisions = Object.values(this.state.releasedChannels).some(
      archReleases => {
        return Object.values(archReleases).some(isInDevmode);
      }
    );

    return (
      <Fragment>
        <div className="row">
          {this.state.error && (
            <Notification status="error" appearance="negative">
              {this.state.error}
            </Notification>
          )}
          {hasDevmodeRevisions && (
            <Notification appearance="caution">
              Revisions in development mode cannot be released to stable or
              candidate channels.
              <br />
              You can read more about{" "}
              <a href="https://docs.snapcraft.io/t/snap-confinement/6233">
                <code>devmode</code> confinement
              </a>{" "}
              and{" "}
              <a href="https://docs.snapcraft.io/t/snapcraft-yaml-reference/4276">
                <code>devel</code> grade
              </a>
              .
            </Notification>
          )}
        </div>

        <ReleasesTable
          // map all the state into props
          {...this.state}
          // actions
          getNextReleasedChannels={this.getNextReleasedChannels.bind(this)}
          setCurrentTrack={this.setCurrentTrack.bind(this)}
          releaseRevisions={this.releaseRevisions.bind(this)}
          promoteRevision={this.promoteRevision.bind(this)}
          promoteChannel={this.promoteChannel.bind(this)}
          undoRelease={this.undoRelease.bind(this)}
          clearPendingReleases={this.clearPendingReleases.bind(this)}
          closeChannel={this.closeChannel.bind(this)}
          toggleHistoryPanel={this.toggleHistoryPanel.bind(this)}
          selectRevision={this.selectRevision.bind(this)}
          closeHistoryPanel={this.closeHistoryPanel.bind(this)}
        />
      </Fragment>
    );
  }
}

ReleasesController.propTypes = {
  snapName: PropTypes.string.isRequired,
  channelMapsList: PropTypes.array.isRequired,
  releasesData: PropTypes.object.isRequired,
  options: PropTypes.object.isRequired
};
